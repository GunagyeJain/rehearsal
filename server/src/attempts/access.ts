import { isValidObjectId, Types } from 'mongoose';
import type { AttemptDetailResponse, Scenario } from '@rehearsal/shared';
import { HttpError, notFound } from '../http/HttpError';
import { AttemptModel, type AttemptDoc } from '../models/Attempt';
import type { ScenarioStore } from '../content/loadScenarios';
import { progressInfo } from './progress';
import { toAttemptDto, toScenarioRef } from './serialize';

/** Attempts left in_progress this long are abandoned lazily (spec/api.md). */
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/** Parse a path id; anything that is not an ObjectId is simply not found. */
export function parseObjectId(raw: unknown): Types.ObjectId {
  if (typeof raw !== 'string' || !isValidObjectId(raw) || !/^[0-9a-f]{24}$/i.test(raw)) throw notFound();
  return new Types.ObjectId(raw);
}

/** The user's own attempt or 404 (another user's id is indistinguishable from a missing one). */
export async function loadOwnedAttempt(userId: Types.ObjectId, rawId: unknown): Promise<AttemptDoc> {
  const id = parseObjectId(rawId);
  const attempt = await AttemptModel.findOne({ _id: id, userId }).lean<AttemptDoc>();
  if (!attempt) throw notFound('That attempt does not exist.');
  return attempt;
}

export function scenarioForAttempt(store: ScenarioStore, attempt: Pick<AttemptDoc, 'scenarioId'>): Scenario {
  const scenario = store.get(attempt.scenarioId);
  if (!scenario) throw notFound('That scenario is no longer available.');
  return scenario;
}

function isStaleInProgress(attempt: Pick<AttemptDoc, 'status' | 'startedAt'>, now: number): boolean {
  return attempt.status === 'in_progress' && now - attempt.startedAt.getTime() > ABANDON_AFTER_MS;
}

/** Mark an over-age in_progress attempt abandoned. Returns the (possibly updated) attempt. */
export async function abandonIfStale(attempt: AttemptDoc, now = Date.now()): Promise<AttemptDoc> {
  if (!isStaleInProgress(attempt, now)) return attempt;
  await AttemptModel.updateOne({ _id: attempt._id, userId: attempt.userId, status: 'in_progress' }, { $set: { status: 'abandoned' } });
  return { ...attempt, status: 'abandoned' };
}

/** Throws 409 ATTEMPT_CLOSED unless the attempt still accepts turns. */
export async function requireOpenAttempt(attempt: AttemptDoc): Promise<AttemptDoc> {
  const current = await abandonIfStale(attempt);
  if (current.status !== 'in_progress') {
    throw new HttpError(409, 'ATTEMPT_CLOSED', 'This attempt is already finished. Start a new one.');
  }
  return current;
}

/** Validate a turn index path param against the scenario: 400 when out of range. */
export function parseTurnIndex(raw: unknown, scenario: Scenario): number {
  const index = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(index) || index < 0 || index >= scenario.turns.length) {
    throw new HttpError(400, 'BAD_REQUEST', 'That turn does not exist in this scenario.');
  }
  return index;
}

export async function buildAttemptDetail(
  attempt: AttemptDoc,
  scenario: Scenario,
  store: ScenarioStore,
): Promise<AttemptDetailResponse> {
  return {
    attempt: toAttemptDto(attempt),
    scenario: toScenarioRef(scenario),
    provisional: attempt.status === 'scoring' ? (attempt.provisional ?? null) : null,
    progress: await progressInfo(attempt.userId, attempt.scenarioId, store),
  };
}
