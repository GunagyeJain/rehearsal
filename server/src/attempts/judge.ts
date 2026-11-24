import type { Types } from 'mongoose';
import { scoreAttempt } from '../services/scoring';
import { AttemptModel, type AttemptDoc, type AttemptTurnDoc } from '../models/Attempt';
import type { ScenarioStore } from '../content/loadScenarios';
import { recordOutcome, refreshBestAttempt } from './progress';
import { safeErrorLabel } from '../http/safeErrorLabel';

/** An attempt stuck in 'scoring' longer than this (server restart mid-judge) is re-judged on GET. */
export const STALE_SCORING_MS = 60_000;

/** Attempt ids with a judge running in this process, so a GET never starts a duplicate. */
const running = new Set<string>();

export function isJudgeRunning(attemptId: Types.ObjectId): boolean {
  return running.has(attemptId.toHexString());
}

export function sortedTurns(turns: readonly AttemptTurnDoc[]): AttemptTurnDoc[] {
  return [...turns].sort((a, b) => a.index - b.index);
}

async function runJudge(attemptId: Types.ObjectId, userId: Types.ObjectId, store: ScenarioStore): Promise<void> {
  const attempt = await AttemptModel.findOne({ _id: attemptId, userId, status: 'scoring' }).lean<AttemptDoc>();
  if (!attempt) return;
  const scenario = store.get(attempt.scenarioId);
  if (!scenario) throw new Error(`scenario ${attempt.scenarioId} is no longer loaded`);
  // scoreAttempt never rejects because of the judge: judge null => judged criteria auto-pass.
  const { verdict, metrics } = await scoreAttempt({ scenario, turns: sortedTurns(attempt.turns) });
  // Progress first (idempotent), so a client that sees 'scored' also sees the updated gating state.
  await recordOutcome(userId, attempt.scenarioId, verdict.passed, store);
  const result = await AttemptModel.updateOne(
    { _id: attemptId, userId, status: 'scoring' },
    { $set: { status: 'scored', verdict, metrics, provisional: null, completedAt: new Date() } },
  );
  if (result.modifiedCount === 1) await refreshBestAttempt(userId, attempt.scenarioId);
}

/**
 * Start the background judge for an attempt already in 'scoring'. Fire-and-forget: failures are
 * logged by attempt id only (never transcripts) and the attempt is re-judged on a later GET.
 */
export function startJudge(attemptId: Types.ObjectId, userId: Types.ObjectId, store: ScenarioStore): void {
  const key = attemptId.toHexString();
  if (running.has(key)) return;
  running.add(key);
  runJudge(attemptId, userId, store)
    .catch((error: unknown) => {
      console.error(`[judge] attempt ${key} could not be scored: ${safeErrorLabel(error)}`);
    })
    .finally(() => running.delete(key));
}
