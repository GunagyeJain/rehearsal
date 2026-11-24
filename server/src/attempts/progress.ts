import type { Types } from 'mongoose';
import {
  derivePathItems,
  isPathComplete,
  type AttemptProgressInfo,
  type PathItem,
  type PathProgressInfo,
  type PathScenarioInfo,
  type PathView,
} from '@rehearsal/shared';
import { AttemptModel } from '../models/Attempt';
import { PathModel, type PathDoc } from '../models/Path';
import { ProgressModel, type ProgressDoc } from '../models/Progress';
import type { ScenarioStore } from '../content/loadScenarios';
import { HttpError, notFound } from '../http/HttpError';
import { loadPathView } from '../paths/pathView';
import { isUserActive } from '../users/activeUser';
import type { UserScenarioState } from './serialize';

/**
 * Progress bookkeeping and gating (spec/scoring.md "Gating"). Every query is scoped by userId.
 * Unlocked / current / canSkip are derived from the path order and stored outcomes on every
 * read (derivePathItems); only outcomes (passed / failed / skipped) and counts are stored.
 */

function toProgressInfo(p: ProgressDoc): PathProgressInfo {
  return {
    status: p.status,
    attemptCount: p.attemptCount,
    bestAttemptId: p.bestAttemptId?.toHexString() ?? null,
    lastAttemptId: p.lastAttemptId?.toHexString() ?? null,
  };
}

function scenarioInfo(store: ScenarioStore): Map<string, PathScenarioInfo> {
  return new Map<string, PathScenarioInfo>(store.list().map((s) => [s.id, s]));
}

interface LoadedPath {
  path: PathDoc;
  items: PathItem[];
}

async function loadPath(userId: Types.ObjectId, store: ScenarioStore): Promise<LoadedPath | null> {
  const path = await PathModel.findOne({ userId }).lean<PathDoc>();
  if (!path) return null;
  const rows = await ProgressModel.find({ userId, scenarioId: { $in: path.scenarioIds } }).lean<ProgressDoc[]>();
  const progress = new Map<string, PathProgressInfo>(rows.map((p) => [p.scenarioId, toProgressInfo(p)]));
  return { path, items: derivePathItems(path.scenarioIds, scenarioInfo(store), progress) };
}

/** An upsert can recreate rows for an account deleted meanwhile: remove them again. */
async function discardIfUserDeleted(userId: Types.ObjectId): Promise<void> {
  if (!(await isUserActive(userId))) await ProgressModel.deleteMany({ userId });
}

/** Called once per finalize (never twice for one attempt): counts the attempt. */
export async function countAttempt(userId: Types.ObjectId, scenarioId: string, attemptId: Types.ObjectId): Promise<void> {
  await ProgressModel.updateOne(
    { userId, scenarioId },
    {
      $inc: { attemptCount: 1 },
      $set: { lastAttemptId: attemptId },
      $setOnInsert: { status: 'available', unlockedAt: new Date() },
    },
    { upsert: true },
  );
  await discardIfUserDeleted(userId);
}

async function bestAttemptId(userId: Types.ObjectId, scenarioId: string): Promise<Types.ObjectId | null> {
  const best = await AttemptModel.findOne({ userId, scenarioId, status: 'scored' })
    .sort({ 'verdict.passedCount': -1, completedAt: -1 })
    .select('_id')
    .lean();
  return best?._id ?? null;
}

/**
 * After an item clears: stamp unlockedAt on the next path item (bookkeeping only; unlocking itself
 * is derived), and set path.completedAt once every item is passed or skipped.
 */
async function afterCleared(userId: Types.ObjectId, scenarioId: string, store: ScenarioStore): Promise<void> {
  const loaded = await loadPath(userId, store);
  if (!loaded) return;
  const position = loaded.path.scenarioIds.indexOf(scenarioId);
  const nextId = position >= 0 ? loaded.path.scenarioIds[position + 1] : undefined;
  if (nextId !== undefined) {
    await ProgressModel.updateOne(
      { userId, scenarioId: nextId },
      { $setOnInsert: { status: 'available', attemptCount: 0 } },
      { upsert: true },
    );
    await ProgressModel.updateOne({ userId, scenarioId: nextId, unlockedAt: null }, { $set: { unlockedAt: new Date() } });
    await discardIfUserDeleted(userId);
  }
  if (loaded.path.completedAt === null && isPathComplete(loaded.items)) {
    await PathModel.updateOne({ _id: loaded.path._id, userId, completedAt: null }, { $set: { completedAt: new Date() } });
  }
}

/**
 * After scoring, before the attempt is marked scored. A pass always records 'passed' (upgrading a skipped item too); a miss records
 * 'failed' only when the item is not already passed or skipped, so a reattempt never downgrades.
 */
export async function recordOutcome(
  userId: Types.ObjectId,
  scenarioId: string,
  passed: boolean,
  store: ScenarioStore,
): Promise<void> {
  if (passed) {
    await ProgressModel.updateOne({ userId, scenarioId }, { $set: { status: 'passed' } });
  } else {
    await ProgressModel.updateOne(
      { userId, scenarioId, status: { $nin: ['passed', 'skipped'] } },
      { $set: { status: 'failed' } },
    );
  }
  if (passed) await afterCleared(userId, scenarioId, store);
}

/** After an attempt is stored as scored: best attempt = highest passedCount (ties: latest). */
export async function refreshBestAttempt(userId: Types.ObjectId, scenarioId: string): Promise<void> {
  await ProgressModel.updateOne({ userId, scenarioId }, { $set: { bestAttemptId: await bestAttemptId(userId, scenarioId) } });
}

/**
 * POST /api/path/:scenarioId/skip. Allowed only for an actionable path item (unlocked, not passed
 * or skipped) with at least SKIP_AFTER_ATTEMPTS attempts. Marks it skipped, which unlocks the next.
 */
export async function skipPathItem(userId: Types.ObjectId, scenarioId: string, store: ScenarioStore): Promise<PathView> {
  const loaded = await loadPath(userId, store);
  const item = loaded?.items.find((i) => i.scenarioId === scenarioId);
  if (!loaded || !item) throw notFound('That scenario is not on your path.');
  if (!item.canSkip) {
    throw new HttpError(409, 'SKIP_NOT_ALLOWED', 'Skip for now becomes available after a few attempts.');
  }
  await ProgressModel.updateOne(
    { userId, scenarioId, status: { $nin: ['passed', 'skipped'] } },
    { $set: { status: 'skipped' } },
  );
  await afterCleared(userId, scenarioId, store);
  const view = await loadPathView(userId, store);
  if (!view) throw notFound('That scenario is not on your path.');
  return view;
}

export async function progressInfo(
  userId: Types.ObjectId,
  scenarioId: string,
  store: ScenarioStore,
): Promise<AttemptProgressInfo> {
  const [progress, loaded] = await Promise.all([
    ProgressModel.findOne({ userId, scenarioId }).lean<ProgressDoc>(),
    loadPath(userId, store),
  ]);
  const position = loaded ? loaded.path.scenarioIds.indexOf(scenarioId) : -1;
  const item = loaded && position >= 0 ? loaded.items[position] : undefined;
  return {
    status: item?.state ?? progress?.status ?? 'available',
    attemptCount: progress?.attemptCount ?? 0,
    // Skip is a path concept: scenarios reached from Explore never offer it.
    canSkip: item?.canSkip ?? false,
    nextScenarioId: loaded && position >= 0 ? (loaded.path.scenarioIds[position + 1] ?? null) : null,
    onPath: position >= 0,
  };
}

/** Per-scenario state for summaries (library list and scenario detail); path items use derived state. */
export async function userScenarioStates(
  userId: Types.ObjectId,
  store: ScenarioStore,
): Promise<{
  states: ReadonlyMap<string, UserScenarioState>;
  canSkip: (scenarioId: string) => boolean;
  onPath: (scenarioId: string) => boolean;
}> {
  const [rows, loaded] = await Promise.all([ProgressModel.find({ userId }).lean<ProgressDoc[]>(), loadPath(userId, store)]);
  const items = new Map((loaded?.items ?? []).map((i) => [i.scenarioId, i]));
  const states = new Map<string, UserScenarioState>(
    rows.map((p) => [p.scenarioId, { onPath: items.has(p.scenarioId), state: p.status, attemptCount: p.attemptCount }]),
  );
  for (const item of items.values()) {
    states.set(item.scenarioId, { onPath: true, state: item.state, attemptCount: item.attemptCount });
  }
  return {
    states,
    canSkip: (id) => items.get(id)?.canSkip ?? false,
    onPath: (id) => items.has(id),
  };
}
