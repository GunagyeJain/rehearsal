import { Router, type RequestHandler } from 'express';
import type { Types } from 'mongoose';
import {
  startAttemptSchema,
  validateUserInputs,
  type GenerateTurnResponse,
  type Scenario,
  type StartAttemptResponse,
  type UserInputValues,
} from '@rehearsal/shared';
import { HttpError, notFound } from '../http/HttpError';
import { parseBody } from '../middleware/validate';
import { userIdOf } from '../middleware/requireUser';
import { AttemptModel, type AttemptDoc } from '../models/Attempt';
import { UserModel, type UserDoc } from '../models/User';
import type { ScenarioStore } from '../content/loadScenarios';
import { scoreFirstPass } from '../services/scoring';
import {
  ABANDON_AFTER_MS,
  abandonIfStale,
  buildAttemptDetail,
  loadOwnedAttempt,
  parseTurnIndex,
  requireOpenAttempt,
  scenarioForAttempt,
} from '../attempts/access';
import { isJudgeRunning, sortedTurns, STALE_SCORING_MS, startJudge } from '../attempts/judge';
import { countAttempt } from '../attempts/progress';
import { produceTurnLine } from '../attempts/turnLine';
import { accountGoneError, isUserActive } from '../users/activeUser';

export interface AttemptsRouterDeps {
  scenarios: () => ScenarioStore;
  requireUser: RequestHandler;
  generationLimiter: RequestHandler;
}

/** Keep only the scenario's declared inputs, trimmed. */
function cleanUserInputs(scenario: Scenario, raw: Readonly<Record<string, string>>): UserInputValues {
  const values: Record<string, string> = {};
  for (const field of scenario.userInputs) {
    const value = raw[field.key];
    if (typeof value === 'string' && value.trim() !== '') values[field.key] = value.trim();
  }
  return values;
}

/** A brief viewed again within this window reuses its unanswered attempt instead of generating anew. */
export const REUSE_ATTEMPT_MS = 30 * 60 * 1000;

function sameInputs(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((k, i) => k === bKeys[i] && a[k] === b[k]);
}

/**
 * The caller's most recent in_progress attempt for this scenario, if it is under REUSE_ATTEMPT_MS old,
 * has identical userInputs and no answered turns; otherwise null.
 */
async function findReusableAttempt(
  userId: Types.ObjectId,
  scenarioId: string,
  userInputs: UserInputValues,
  now = Date.now(),
): Promise<AttemptDoc | null> {
  const latest = await AttemptModel.findOne({ userId, scenarioId, status: 'in_progress' })
    .sort({ startedAt: -1 })
    .select({ userInputs: 1, startedAt: 1, 'turns.index': 1, 'turns.aiText': 1, 'turns.audioId': 1, 'turns.transcript': 1 })
    .lean<AttemptDoc>();
  if (!latest || now - latest.startedAt.getTime() >= REUSE_ATTEMPT_MS) return null;
  if (!sameInputs(latest.userInputs, userInputs)) return null;
  const answered = latest.turns.some((t) => t.audioId !== null || t.transcript !== '');
  if (answered || !latest.turns.some((t) => t.index === 0)) return null;
  return latest;
}

/** Lazily mark the caller's over-age in_progress attempts abandoned (spec/api.md lifecycle). */
async function abandonStaleAttempts(userId: Types.ObjectId, now = Date.now()): Promise<void> {
  await AttemptModel.updateMany(
    { userId, status: 'in_progress', startedAt: { $lt: new Date(now - ABANDON_AFTER_MS) } },
    { $set: { status: 'abandoned' } },
  );
}

async function loadProfile(userId: Types.ObjectId): Promise<UserDoc['profile']> {
  const user = await UserModel.findOne({ _id: userId }).select('profile').lean<Pick<UserDoc, 'profile'>>();
  return user?.profile ?? null;
}

/** Generate and store the line for turnIndex; idempotent under concurrent calls. */
async function generateTurn(attempt: AttemptDoc, scenario: Scenario, turnIndex: number): Promise<string> {
  const existing = attempt.turns.find((t) => t.index === turnIndex);
  if (existing) return existing.aiText;
  const previous = attempt.turns.find((t) => t.index === turnIndex - 1);
  if (!previous) throw new HttpError(409, 'TURN_OUT_OF_ORDER', 'Answer the earlier question first.');
  if (scenario.turns[turnIndex]?.dependsOnPreviousAnswer && previous.words.length === 0) {
    throw new HttpError(409, 'PREVIOUS_ANSWER_REQUIRED', 'This question follows on from your last answer. Answer that first.');
  }
  const text = await produceTurnLine({
    scenario,
    turnIndex,
    userInputs: attempt.userInputs,
    profile: await loadProfile(attempt.userId),
    previousTurns: attempt.turns,
  });
  const pushed = await AttemptModel.updateOne(
    { _id: attempt._id, userId: attempt.userId, status: 'in_progress', 'turns.index': { $ne: turnIndex } },
    { $push: { turns: { index: turnIndex, aiText: text, audioId: null, transcript: '', words: [] } } },
  );
  if (pushed.modifiedCount === 1) return text;
  // Lost a race with a concurrent call (or the attempt closed): return what is stored.
  const current = await AttemptModel.findOne({ _id: attempt._id, userId: attempt.userId }).lean<AttemptDoc>();
  const stored = current?.turns.find((t) => t.index === turnIndex);
  if (!stored) throw new HttpError(409, 'ATTEMPT_CLOSED', 'This attempt is already finished. Start a new one.');
  return stored.aiText;
}

function allTurnsHaveWords(attempt: AttemptDoc, scenario: Scenario): boolean {
  return scenario.turns.every((st) => (attempt.turns.find((t) => t.index === st.index)?.words.length ?? 0) > 0);
}

export function createAttemptsRouter(deps: AttemptsRouterDeps): Router {
  const router = Router();

  router.post('/attempts', deps.requireUser, deps.generationLimiter, async (req, res) => {
    const userId = userIdOf(req);
    const body = parseBody(startAttemptSchema, req.body);
    const scenario = deps.scenarios().get(body.scenarioId);
    if (!scenario) throw notFound('That scenario does not exist.');
    const errors = validateUserInputs(scenario.userInputs, body.userInputs);
    if (Object.keys(errors).length > 0) {
      const fields = Object.fromEntries(Object.entries(errors).map(([k, v]) => [`userInputs.${k}`, v]));
      throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', fields);
    }
    const userInputs = cleanUserInputs(scenario, body.userInputs);
    await abandonStaleAttempts(userId);
    const reusable = await findReusableAttempt(userId, scenario.id, userInputs);
    const reusedTurn = reusable?.turns.find((t) => t.index === 0);
    if (reusable && reusedTurn) {
      const reused: StartAttemptResponse = { attemptId: reusable._id.toHexString(), turn: { index: 0, text: reusedTurn.aiText } };
      res.status(200).json(reused);
      return;
    }
    const text = await produceTurnLine({
      scenario,
      turnIndex: 0,
      userInputs,
      profile: await loadProfile(userId),
      previousTurns: [],
    });
    const attempt = await AttemptModel.create({
      userId,
      scenarioId: scenario.id,
      userInputs,
      status: 'in_progress',
      turns: [{ index: 0, aiText: text, audioId: null, transcript: '', words: [] }],
    });
    // Generation can take tens of seconds: if the account was deleted meanwhile, leave nothing behind.
    if (!(await isUserActive(userId))) {
      await AttemptModel.deleteOne({ _id: attempt._id, userId });
      throw accountGoneError();
    }
    const response: StartAttemptResponse = { attemptId: attempt._id.toHexString(), turn: { index: 0, text } };
    res.status(201).json(response);
  });

  router.post('/attempts/:id/turns/:turnIndex/generate', deps.requireUser, deps.generationLimiter, async (req, res) => {
    const attempt = await loadOwnedAttempt(userIdOf(req), req.params.id);
    const scenario = scenarioForAttempt(deps.scenarios(), attempt);
    const turnIndex = parseTurnIndex(req.params.turnIndex, scenario);
    const stored = attempt.turns.find((t) => t.index === turnIndex);
    const text = stored ? stored.aiText : await generateTurn(await requireOpenAttempt(attempt), scenario, turnIndex);
    const response: GenerateTurnResponse = { index: turnIndex, text };
    res.json(response);
  });

  router.post('/attempts/:id/finalize', deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const loaded = await loadOwnedAttempt(userId, req.params.id);
    const scenario = scenarioForAttempt(deps.scenarios(), loaded);
    if (loaded.status === 'scored' || loaded.status === 'scoring') {
      res.status(loaded.status === 'scored' ? 200 : 202).json(await buildAttemptDetail(loaded, scenario, deps.scenarios()));
      return;
    }
    const attempt = await requireOpenAttempt(loaded);
    if (!allTurnsHaveWords(attempt, scenario)) {
      throw new HttpError(409, 'TURNS_INCOMPLETE', 'Answer every question before finishing.');
    }
    const { provisional } = scoreFirstPass(scenario, sortedTurns(attempt.turns));
    const updated = await AttemptModel.findOneAndUpdate(
      { _id: attempt._id, userId, status: 'in_progress' },
      { $set: { status: 'scoring', metrics: provisional.metrics, provisional, scoringStartedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<AttemptDoc>();
    if (!updated) {
      // A concurrent finalize won; report its state without counting twice.
      const current = await loadOwnedAttempt(userId, req.params.id);
      res.status(current.status === 'scored' ? 200 : 202).json(await buildAttemptDetail(current, scenario, deps.scenarios()));
      return;
    }
    await countAttempt(userId, scenario.id, updated._id);
    startJudge(updated._id, userId, deps.scenarios());
    res.status(202).json(await buildAttemptDetail(updated, scenario, deps.scenarios()));
  });

  router.get('/attempts/:id', deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const attempt = await abandonIfStale(await loadOwnedAttempt(userId, req.params.id));
    const scenario = scenarioForAttempt(deps.scenarios(), attempt);
    const startedAt = attempt.scoringStartedAt?.getTime() ?? 0;
    if (attempt.status === 'scoring' && Date.now() - startedAt > STALE_SCORING_MS && !isJudgeRunning(attempt._id)) {
      await AttemptModel.updateOne({ _id: attempt._id, userId, status: 'scoring' }, { $set: { scoringStartedAt: new Date() } });
      startJudge(attempt._id, userId, deps.scenarios());
    }
    res.set('Cache-Control', 'no-store').json(await buildAttemptDetail(attempt, scenario, deps.scenarios()));
  });

  return router;
}
