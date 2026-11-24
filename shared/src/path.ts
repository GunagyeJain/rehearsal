import { SKIP_AFTER_ATTEMPTS } from './constants';
import type { PathItem, ProgressStatus } from './domain';
import type { TrackId } from './scenario';

/**
 * Path state derivation — spec/scoring.md "Gating" and spec/data-model.md "Derived, never stored".
 * Item 0 is always unlocked; item i unlocks when item i-1 is passed or skipped.
 */

export interface PathScenarioInfo {
  id: string;
  title: string;
  track: TrackId;
  difficulty: number;
}

export interface PathProgressInfo {
  /** Stored outcome: only 'passed' | 'failed' | 'skipped' carry meaning here; anything else means "not attempted to a result". */
  status: ProgressStatus;
  attemptCount: number;
  bestAttemptId: string | null;
  lastAttemptId: string | null;
}

const isCleared = (s: ProgressStatus | undefined): boolean => s === 'passed' || s === 'skipped';

export function derivePathItems(
  scenarioIds: readonly string[],
  scenarios: ReadonlyMap<string, PathScenarioInfo>,
  progress: ReadonlyMap<string, PathProgressInfo>,
): PathItem[] {
  let currentAssigned = false;
  return scenarioIds.map((scenarioId, position) => {
    const info = scenarios.get(scenarioId);
    const p = progress.get(scenarioId);
    const prevId = position > 0 ? scenarioIds[position - 1] : undefined;
    const unlocked = position === 0 || (prevId !== undefined && isCleared(progress.get(prevId)?.status));
    const attemptCount = p?.attemptCount ?? 0;

    let state: ProgressStatus;
    if (p?.status === 'passed') state = 'passed';
    else if (p?.status === 'skipped') state = 'skipped';
    else if (!unlocked) state = 'locked';
    else if (attemptCount > 0) state = 'failed';
    else state = 'available';

    const actionable = state === 'available' || state === 'failed';
    const isCurrent = actionable && !currentAssigned;
    if (isCurrent) currentAssigned = true;

    return {
      position,
      scenarioId,
      title: info?.title ?? scenarioId,
      track: info?.track ?? 'fundamentals',
      difficulty: info?.difficulty ?? 1,
      state,
      attemptCount,
      canSkip: actionable && attemptCount >= SKIP_AFTER_ATTEMPTS,
      isCurrent,
      lastAttemptId: p?.lastAttemptId ?? null,
      bestAttemptId: p?.bestAttemptId ?? null,
    };
  });
}

export function isPathComplete(items: readonly Pick<PathItem, 'state'>[]): boolean {
  return items.length > 0 && items.every((i) => isCleared(i.state));
}

export function pathClearedCount(items: readonly Pick<PathItem, 'state'>[]): number {
  return items.filter((i) => isCleared(i.state)).length;
}
