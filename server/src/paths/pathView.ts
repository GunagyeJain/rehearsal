import type { Types } from 'mongoose';
import {
  derivePathItems,
  isPathComplete,
  pathClearedCount,
  type PathProgressInfo,
  type PathScenarioInfo,
  type PathView,
} from '@rehearsal/shared';
import { PathModel, type PathDoc } from '../models/Path';
import { ProgressModel, type ProgressDoc } from '../models/Progress';
import type { ScenarioStore } from '../content/loadScenarios';

/** Build the PathView for a stored path. Item state is derived on every call, never stored. */
export async function toPathView(userId: Types.ObjectId, path: PathDoc, store: ScenarioStore): Promise<PathView> {
  const rows = await ProgressModel.find({ userId, scenarioId: { $in: path.scenarioIds } }).lean<ProgressDoc[]>();
  const progress = new Map<string, PathProgressInfo>(
    rows.map((p) => [
      p.scenarioId,
      {
        status: p.status,
        attemptCount: p.attemptCount,
        bestAttemptId: p.bestAttemptId?.toHexString() ?? null,
        lastAttemptId: p.lastAttemptId?.toHexString() ?? null,
      },
    ]),
  );
  const scenarios = new Map<string, PathScenarioInfo>(store.list().map((s) => [s.id, s]));
  const items = derivePathItems(path.scenarioIds, scenarios, progress);
  return {
    items,
    clearedCount: pathClearedCount(items),
    totalCount: items.length,
    complete: isPathComplete(items),
    generatedAt: path.generatedAt.toISOString(),
    completedAt: path.completedAt?.toISOString() ?? null,
  };
}

/** The signed-in user's path view, or null before onboarding finishes. */
export async function loadPathView(userId: Types.ObjectId, store: ScenarioStore): Promise<PathView | null> {
  const path = await PathModel.findOne({ userId }).lean<PathDoc>();
  return path ? toPathView(userId, path, store) : null;
}
