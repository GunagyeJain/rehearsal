import { Router, type RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import {
  BASELINE_MAX_SECONDS,
  computeMetrics,
  profileInputSchema,
  scenarioDescription,
  type AuthUserResponse,
  type BaselineMetrics,
  type BaselineResponse,
  type GeneratePathResponse,
  type Metrics,
  type PathResponse,
  type UserProfile,
} from '@rehearsal/shared';
import { HttpError, notFound } from '../http/HttpError';
import { safeErrorLabel } from '../http/safeErrorLabel';
import { parseBody } from '../middleware/validate';
import { userIdOf } from '../middleware/requireUser';
import { audioUpload, normalizeAudioMime } from '../middleware/audioUpload';
import { UserModel, type BaselineRecord, type UserDoc } from '../models/User';
import { PathModel, type PathDoc } from '../models/Path';
import { ProgressModel } from '../models/Progress';
import type { ScenarioStore } from '../content/loadScenarios';
import { generateBaselineFeedback } from '../services/claude';
import { generatePath } from '../services/path';
import { putRecording } from '../storage/recordings';
import { loadPathView, toPathView } from '../paths/pathView';
import { loadUserDto } from '../users/serialize';
import { accountGoneError, isUserActive } from '../users/activeUser';
import { discardRecording, mediaDurationSec, transcribeTake } from './answers';

export interface OnboardingRouterDeps {
  scenarios: () => ScenarioStore;
  requireUser: RequestHandler;
  uploadLimiter: RequestHandler;
}

/** Slack over the 120 s cap: the client stops at the cap, but wall-clock timing can run a little over. */
const MAX_BASELINE_REPORTED_SEC = BASELINE_MAX_SECONDS * 2;
const DUPLICATE_KEY = 11000;

const baselineFieldsSchema = z.object({
  durationSec: z.coerce.number().positive().max(MAX_BASELINE_REPORTED_SEC),
});

const pathExists = (): HttpError =>
  new HttpError(409, 'PATH_EXISTS', 'Your path is already set.');
const profileRequired = (): HttpError => new HttpError(409, 'PROFILE_REQUIRED', 'Answer the onboarding questions first.');

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY;
}

function baselineMetrics(metrics: Metrics): BaselineMetrics {
  return {
    wpm: metrics.wpm,
    fillersPerMinute: metrics.fillersPerMinute,
    fillerCount: metrics.fillerCount,
    longestPauseSec: metrics.longestPauseSec,
    pauseCount2s: metrics.pauseCount2s,
    durationSec: metrics.durationSec,
    wordCount: metrics.wordCount,
  };
}

async function hasPath(userId: Types.ObjectId): Promise<boolean> {
  return (await PathModel.exists({ userId })) !== null;
}

async function loadOnboardingUser(userId: Types.ObjectId): Promise<Pick<UserDoc, 'profile' | 'baseline'>> {
  const user = await UserModel.findOne({ _id: userId }).select('profile baseline').lean<Pick<UserDoc, 'profile' | 'baseline'>>();
  if (!user) throw notFound('Account not found.');
  return user;
}

/** The first path item starts unlocked (spec/api.md). Upsert so a repeat or race never duplicates it. */
async function unlockFirstItem(userId: Types.ObjectId, path: Pick<PathDoc, 'scenarioIds'>): Promise<void> {
  const first = path.scenarioIds[0];
  if (!first) return;
  await ProgressModel.updateOne(
    { userId, scenarioId: first },
    { $setOnInsert: { status: 'available', attemptCount: 0, unlockedAt: new Date() } },
    { upsert: true },
  );
}

/** /api/onboarding/* and GET /api/path. Every query is scoped to the signed-in user. */
export function createOnboardingRouter(deps: OnboardingRouterDeps): Router {
  const router = Router();

  router.put('/onboarding/profile', deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const input = parseBody(profileInputSchema, req.body);
    if (await hasPath(userId)) throw pathExists();
    const profile: UserProfile = { ...input };
    const updated = await UserModel.updateOne({ _id: userId }, { $set: { profile } });
    if (updated.matchedCount === 0) throw notFound('Account not found.');
    const body: AuthUserResponse = { user: await loadUserDto(userId) };
    res.json(body);
  });

  /** Profile and path checks run before multer, so a rejected upload is never buffered. */
  const precheckBaseline: RequestHandler = async (req, _res, next) => {
    const userId = userIdOf(req);
    const user = await loadOnboardingUser(userId);
    if (!user.profile) throw profileRequired();
    if (await hasPath(userId)) throw pathExists();
    next();
  };

  router.post('/onboarding/baseline', deps.requireUser, deps.uploadLimiter, precheckBaseline, audioUpload, async (req, res) => {
    const userId = userIdOf(req);
    const file = req.file;
    if (!file) throw new HttpError(400, 'VALIDATION_FAILED', 'Attach a recording.', { audio: 'Attach a recording.' });
    const mimeType = normalizeAudioMime(file.mimetype);
    if (!mimeType) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That file is not audio. Record your answer again.');
    const { durationSec } = parseBody(baselineFieldsSchema, req.body);

    const result = await transcribeTake(file.buffer, mimeType, 0);
    const words = result.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
    const metrics = baselineMetrics(computeMetrics(words).metrics);
    const [recordingId, feedback] = await Promise.all([
      putRecording({
        userId,
        kind: 'baseline',
        attemptId: null,
        turnIndex: null,
        mimeType,
        durationSec: mediaDurationSec(result.durationSec, durationSec),
        data: file.buffer,
      }),
      generateBaselineFeedback({ transcript: result.transcript, metrics }),
    ]);

    const baseline: BaselineRecord = {
      recordingId,
      transcript: result.transcript,
      metrics,
      feedback,
      recordedAt: new Date(),
    };
    const previous = await UserModel.findOneAndUpdate({ _id: userId }, { $set: { baseline } }, { returnDocument: 'before' })
      .select('baseline')
      .lean<Pick<UserDoc, 'baseline'>>();
    if (!previous) {
      await discardRecording(userId, recordingId);
      throw notFound('Account not found.');
    }
    // A re-record replaces the previous baseline and its blob.
    const previousId = previous.baseline?.recordingId;
    if (previousId && !previousId.equals(recordingId)) await discardRecording(userId, previousId);

    const body: BaselineResponse = {
      transcript: result.transcript,
      words,
      metrics,
      feedback,
      recordingId: recordingId.toHexString(),
    };
    res.json(body);
  });

  router.post('/onboarding/path', deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const store = deps.scenarios();
    const existing = await PathModel.findOne({ userId }).lean<PathDoc>();
    if (existing) {
      await unlockFirstItem(userId, existing);
      const body: GeneratePathResponse = { path: await toPathView(userId, existing, store), fallback: false };
      res.json(body);
      return;
    }

    const user = await loadOnboardingUser(userId);
    const profile = profileInputSchema.safeParse(user.profile);
    if (!user.profile || !profile.success) throw profileRequired();
    const library = store.list().map((s) => ({
      id: s.id,
      track: s.track,
      title: s.title,
      difficulty: s.difficulty,
      description: scenarioDescription(s),
    }));
    const generated = await generatePath({ profile: profile.data, baseline: user.baseline?.metrics ?? null, library });
    if (generated.fallback) console.warn('[onboarding] path generation used the default path');

    let saved: PathDoc;
    let fallback = generated.fallback;
    try {
      const created = await PathModel.create({ userId, scenarioIds: generated.scenarioIds, generatedAt: new Date() });
      saved = created.toObject<PathDoc>();
    } catch (error: unknown) {
      // A concurrent request created it first: the stored path wins, so the endpoint stays idempotent.
      if (!isDuplicateKey(error)) {
        console.error(`[onboarding] could not save path: ${safeErrorLabel(error)}`);
        throw error;
      }
      const winner = await PathModel.findOne({ userId }).lean<PathDoc>();
      if (!winner) throw error;
      saved = winner;
      fallback = false;
    }
    await unlockFirstItem(userId, saved);
    // Path generation can take minutes: if the account was deleted meanwhile, leave nothing behind.
    if (!(await isUserActive(userId))) {
      await Promise.all([PathModel.deleteMany({ userId }), ProgressModel.deleteMany({ userId })]);
      throw accountGoneError();
    }
    const body: GeneratePathResponse = { path: await toPathView(userId, saved, store), fallback };
    res.json(body);
  });

  router.get('/path', deps.requireUser, async (req, res) => {
    const body: PathResponse = { path: await loadPathView(userIdOf(req), deps.scenarios()) };
    res.json(body);
  });

  return router;
}
