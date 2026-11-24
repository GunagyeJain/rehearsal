import { describe, expect, it } from 'vitest';
import { SKIP_AFTER_ATTEMPTS } from './constants';
import type { ProgressStatus } from './domain';
import { derivePathItems, isPathComplete, pathClearedCount, type PathProgressInfo, type PathScenarioInfo } from './path';

const IDS = ['a', 'b', 'c', 'd'] as const;
const scenarios = new Map<string, PathScenarioInfo>(
  IDS.map((id, i) => [id, { id, title: `Scenario ${id}`, track: 'fundamentals', difficulty: i + 1 }]),
);

function progressOf(entries: Record<string, [ProgressStatus, number]>): Map<string, PathProgressInfo> {
  return new Map(
    Object.entries(entries).map(([id, [status, attemptCount]]) => [
      id,
      { status, attemptCount, bestAttemptId: null, lastAttemptId: null },
    ]),
  );
}

function derive(entries: Record<string, [ProgressStatus, number]> = {}) {
  return derivePathItems(IDS, scenarios, progressOf(entries));
}

describe('derivePathItems: unlocking in path order', () => {
  it('unlocks only the first item for a new user', () => {
    const items = derive();
    expect(items.map((i) => i.state)).toEqual(['available', 'locked', 'locked', 'locked']);
    expect(items.map((i) => i.isCurrent)).toEqual([true, false, false, false]);
  });

  it('keeps the next item locked while the current one is not yet passed', () => {
    const items = derive({ a: ['failed', 2] });
    expect(items.map((i) => i.state)).toEqual(['failed', 'locked', 'locked', 'locked']);
    expect(items[0]?.isCurrent).toBe(true);
  });

  it('unlocks the next item when the current one passes', () => {
    const items = derive({ a: ['passed', 1] });
    expect(items.map((i) => i.state)).toEqual(['passed', 'available', 'locked', 'locked']);
    expect(items.findIndex((i) => i.isCurrent)).toBe(1);
  });

  it('unlocks the next item when the current one is skipped', () => {
    const items = derive({ a: ['skipped', 3] });
    expect(items.map((i) => i.state)).toEqual(['skipped', 'available', 'locked', 'locked']);
    expect(items.findIndex((i) => i.isCurrent)).toBe(1);
  });

  it('treats an attempted but unscored item as failed only once attempts exist', () => {
    expect(derive({ a: ['available', 0] })[0]?.state).toBe('available');
    expect(derive({ a: ['available', 1] })[0]?.state).toBe('failed');
  });

  it('shows a locked item passed out of order as passed, without unlocking beyond the gap', () => {
    const items = derive({ c: ['passed', 1] });
    expect(items.map((i) => i.state)).toEqual(['available', 'locked', 'passed', 'available']);
    expect(items.findIndex((i) => i.isCurrent)).toBe(0);
  });

  it('marks exactly one current item, the first actionable one', () => {
    const items = derive({ a: ['passed', 1], b: ['skipped', 3], c: ['failed', 1] });
    expect(items.filter((i) => i.isCurrent).map((i) => i.scenarioId)).toEqual(['c']);
  });

  it('has no current item once everything is cleared', () => {
    const items = derive({ a: ['passed', 1], b: ['skipped', 4], c: ['passed', 2], d: ['passed', 1] });
    expect(items.some((i) => i.isCurrent)).toBe(false);
  });

  it('ignores progress for scenarios not on the path', () => {
    const items = derive({ zzz: ['passed', 5] });
    expect(items.map((i) => i.state)).toEqual(['available', 'locked', 'locked', 'locked']);
  });

  it('falls back to the id when a scenario is no longer in the library', () => {
    const items = derivePathItems(['gone'], scenarios, new Map());
    expect(items[0]).toMatchObject({ title: 'gone', state: 'available', position: 0 });
  });
});

describe('derivePathItems: skip rule', () => {
  it('never offers skip before the third failed attempt', () => {
    for (let count = 0; count < SKIP_AFTER_ATTEMPTS; count += 1) {
      expect(derive({ a: ['failed', count] })[0]?.canSkip).toBe(false);
    }
  });

  it('offers skip from the third failed attempt on and keeps offering it', () => {
    expect(derive({ a: ['failed', SKIP_AFTER_ATTEMPTS] })[0]?.canSkip).toBe(true);
    expect(derive({ a: ['failed', SKIP_AFTER_ATTEMPTS + 5] })[0]?.canSkip).toBe(true);
  });

  it('never offers skip on a passed or skipped item', () => {
    expect(derive({ a: ['passed', 7] })[0]?.canSkip).toBe(false);
    expect(derive({ a: ['skipped', 7] })[0]?.canSkip).toBe(false);
  });

  it('never offers skip on a locked item, even with attempts from Explore', () => {
    const items = derive({ b: ['failed', 4] });
    expect(items[1]?.state).toBe('locked');
    expect(items[1]?.canSkip).toBe(false);
  });
});

describe('path completion', () => {
  it('is complete only when every item is passed or skipped', () => {
    expect(isPathComplete(derive({ a: ['passed', 1], b: ['passed', 1], c: ['skipped', 3] }))).toBe(false);
    const done = derive({ a: ['passed', 1], b: ['passed', 1], c: ['skipped', 3], d: ['passed', 2] });
    expect(isPathComplete(done)).toBe(true);
    expect(pathClearedCount(done)).toBe(4);
  });

  it('an empty path is never complete', () => {
    expect(isPathComplete([])).toBe(false);
  });

  it('counts cleared items', () => {
    expect(pathClearedCount(derive({ a: ['passed', 1], b: ['failed', 1] }))).toBe(1);
  });
});
