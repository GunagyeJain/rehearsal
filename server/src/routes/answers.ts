import { Router, type RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import {
  assertScorableWords,
  isScoringInputError,
  TRANSCRIPT_MIN_AVG_LOGPROB,
  type UploadAnswerResponse,
} from '@rehearsal/shared';
import { HttpError } from '../http/HttpError';
import { parseBody } from '../middleware/validate';
import { userIdOf } from '../middleware/requireUser';
import { audioUpload, normalizeAudioMime } from '../middleware/audioUpload';
import { AttemptModel, type AttemptDoc } from '../models/Attempt';
import type { ScenarioStore } from '../content/loadScenarios';
import { transcribe, type TranscriptionResult } from '../services/groq';
import { deleteUserRecording, putRecording } from '../storage/recordings';
import { loadOwnedAttempt, parseTurnIndex, requireOpenAttempt, scenarioForAttempt } from '../attempts/access';

export interface AnswersRouterDeps {
  scenarios: () => ScenarioStore;
  requireUser: RequestHandler;
  uploadLimiter: RequestHandler;
}

/** Generous ceiling on a client-reported recording length (scenario turns cap at a few minutes). */
const MAX_REPORTED_DURATION_SEC = 900;

const answerFieldsSchema = z.object({
  durationSec: z.coerce.number().positive().max(MAX_REPORTED_DURATION_SEC),
});

const NO_SPEECH = (): HttpError => new HttpError(422, 'NO_SPEECH', 'We did not catch any speech. Try again.');
const UNRELIABLE = (): HttpError =>
  new HttpError(
    422,
    'TRANSCRIPT_UNRELIABLE',
    'That take was too hard to make out, so it was not scored. Record it again, ideally somewhere quieter.',
  );
const MISSING_TIMESTAMPS = (): HttpError =>
  new HttpError(422, 'MISSING_TIMESTAMPS', 'The transcript came back without timings, so it cannot be scored. Record again.');

/** Service errors that describe the take itself (not an outage) carry a string code. */
function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return undefined;
}

function mapTranscriptionError(error: unknown): Error {
  if (error instanceof HttpError || isScoringInputError(error)) return error;
  switch (errorCode(error)) {
    case 'NO_WORDS':
    case 'NO_SPEECH':
      return NO_SPEECH();
    case 'TRANSCRIPT_LOW_CONFIDENCE':
    case 'TRANSCRIPT_UNRELIABLE':
      return UNRELIABLE();
    case 'MISSING_TIMESTAMPS':
    case 'INVALID_TIMESTAMPS':
      return MISSING_TIMESTAMPS();
    default:
      return new HttpError(503, 'UPSTREAM_UNAVAILABLE', 'Transcription is unavailable right now. Try this answer again.');
  }
}

/** Apply spec/api.md transcription rules 2-4. The take is discarded, never scored, on any failure. */
function assertUsableTranscript(result: TranscriptionResult, turnIndex: number): void {
  if (result.words.length === 0) throw NO_SPEECH();
  if (!Number.isFinite(result.meanAvgLogprob) || result.meanAvgLogprob < TRANSCRIPT_MIN_AVG_LOGPROB) throw UNRELIABLE();
  try {
    assertScorableWords(result.words, turnIndex);
  } catch (error: unknown) {
    if (isScoringInputError(error) && error.code === 'NO_WORDS') throw NO_SPEECH();
    throw MISSING_TIMESTAMPS();
  }
}

export async function transcribeTake(audio: Buffer, mimeType: string, turnIndex: number): Promise<TranscriptionResult> {
  let result: TranscriptionResult;
  try {
    result = await transcribe(audio, mimeType);
  } catch (error: unknown) {
    throw mapTranscriptionError(error);
  }
  assertUsableTranscript(result, turnIndex);
  return result;
}

/**
 * Length of the stored audio: the larger of the two figures. Groq's duration stops near the last
 * speech (a 22 s take ending in silence came back as 1.9 s), so on its own it under-reports and the
 * recordings list and player timeline show the wrong length. The client's wall-clock figure covers
 * the trailing silence; it can run slightly long from start latency, which is harmless.
 */
export function mediaDurationSec(transcribedSec: number, clientSec: number): number {
  const transcribed = Number.isFinite(transcribedSec) && transcribedSec > 0 ? transcribedSec : 0;
  const client = Number.isFinite(clientSec) && clientSec > 0 ? clientSec : 0;
  return Math.max(transcribed, client);
}

export async function discardRecording(userId: Types.ObjectId, id: Types.ObjectId): Promise<void> {
  try {
    await deleteUserRecording(userId, id);
  } catch (error: unknown) {
    console.error(`[answers] could not delete recording ${id.toHexString()}: ${error instanceof Error ? error.name : 'unknown'}`);
  }
}

interface AnswerTarget {
  attempt: AttemptDoc;
  scenario: ReturnType<typeof scenarioForAttempt>;
  turnIndex: number;
}

const TARGET_KEY = 'answerTarget';

function answerTargetOf(locals: Record<string, unknown>): AnswerTarget {
  const target = locals[TARGET_KEY];
  if (!target) throw new Error('[answers] answer target missing; precheck did not run');
  return target as AnswerTarget;
}

export function createAnswersRouter(deps: AnswersRouterDeps): Router {
  const router = Router();

  /** Ownership, status and turn checks run before multer, so a rejected upload is never buffered. */
  const precheckAnswer: RequestHandler = async (req, res, next) => {
    const attempt = await requireOpenAttempt(await loadOwnedAttempt(userIdOf(req), req.params.id));
    const scenario = scenarioForAttempt(deps.scenarios(), attempt);
    const turnIndex = parseTurnIndex(req.params.turnIndex, scenario);
    const turn = attempt.turns.find((t) => t.index === turnIndex);
    if (!turn?.aiText) throw new HttpError(409, 'TURN_OUT_OF_ORDER', 'That question has not been asked yet.');
    const target: AnswerTarget = { attempt, scenario, turnIndex };
    res.locals[TARGET_KEY] = target;
    next();
  };

  router.post(
    '/attempts/:id/turns/:turnIndex/answer',
    deps.requireUser,
    deps.uploadLimiter,
    precheckAnswer,
    audioUpload,
    async (req, res) => {
      const userId = userIdOf(req);
      const { attempt, scenario, turnIndex } = answerTargetOf(res.locals);
      const file = req.file;
      if (!file) throw new HttpError(400, 'VALIDATION_FAILED', 'Attach a recording.', { audio: 'Attach a recording.' });
      const mimeType = normalizeAudioMime(file.mimetype);
      if (!mimeType) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That file is not audio. Record your answer again.');
      const { durationSec } = parseBody(answerFieldsSchema, req.body);

      const result = await transcribeTake(file.buffer, mimeType, turnIndex);
      const audioDurationSec = mediaDurationSec(result.durationSec, durationSec);
      const audioId = await putRecording({
        userId,
        kind: 'attempt',
        attemptId: attempt._id,
        turnIndex,
        mimeType,
        durationSec: audioDurationSec,
        data: file.buffer,
      });
      const words = result.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
      const updated = await AttemptModel.findOneAndUpdate(
        { _id: attempt._id, userId, status: 'in_progress', 'turns.index': turnIndex },
        {
          $set: {
            'turns.$.audioId': audioId,
            'turns.$.transcript': result.transcript,
            'turns.$.words': words,
            'turns.$.audioDurationSec': audioDurationSec,
          },
        },
        { returnDocument: 'before' },
      ).lean<AttemptDoc>();
      if (!updated) {
        await discardRecording(userId, audioId);
        throw new HttpError(409, 'ATTEMPT_CLOSED', 'This attempt is already finished. Start a new one.');
      }
      // Retry-a-turn: the replaced take's blob goes.
      const previousAudioId = updated.turns.find((t) => t.index === turnIndex)?.audioId;
      if (previousAudioId) await discardRecording(userId, previousAudioId);

      const answered = new Set(updated.turns.filter((t) => t.words.length > 0).map((t) => t.index));
      answered.add(turnIndex);
      const response: UploadAnswerResponse = {
        turn: { index: turnIndex, transcript: result.transcript, words, audioId: audioId.toHexString() },
        allTurnsAnswered: scenario.turns.every((t) => answered.has(t.index)),
      };
      res.json(response);
    },
  );

  return router;
}
