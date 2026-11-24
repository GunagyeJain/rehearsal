import { describe, expect, it } from 'vitest';
import type { AttemptHistoryGroup, ScenarioListResponse, ScenarioSummary } from '@rehearsal/shared';
import { bestResults, EMPTY_FILTER, filterTracks, isFiltered, scenarioHref, tracksWithContent } from './exploreModel';

function summary(id: string, difficulty: number, title: string, hasSetup = false): ScenarioSummary {
  return {
    id,
    track: 'fundamentals',
    title,
    description: `About ${title.toLowerCase()}`,
    difficulty,
    turnCount: 1,
    expectedDurationSec: 60,
    hasSetup,
    onPath: false,
    state: null,
    attemptCount: 0,
  };
}

const list: ScenarioListResponse = {
  tracks: [
    { track: 'fundamentals', label: 'Fundamentals', scenarios: [summary('a', 1, 'Self-introduction'), summary('b', 3, 'Explain a process', true)] },
    { track: 'professional', label: 'Professional', scenarios: [] },
  ],
};

describe('explore model', () => {
  it('shows only tracks with content', () => {
    expect(tracksWithContent(list).map((t) => t.track)).toEqual(['fundamentals']);
  });

  it('filters by search text and difficulty and drops emptied tracks', () => {
    const tracks = tracksWithContent(list);
    expect(filterTracks(tracks, { ...EMPTY_FILTER, query: 'process' })[0]?.scenarios.map((s) => s.id)).toEqual(['b']);
    expect(filterTracks(tracks, { ...EMPTY_FILTER, difficulty: 1 })[0]?.scenarios.map((s) => s.id)).toEqual(['a']);
    expect(filterTracks(tracks, { ...EMPTY_FILTER, track: 'stage' })).toEqual([]);
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, query: '  ' })).toBe(false);
  });

  it('opens setup only for scenarios that have one', () => {
    expect(scenarioHref({ id: 'a', hasSetup: false })).toBe('/scenarios/a/brief');
    expect(scenarioHref({ id: 'b', hasSetup: true })).toBe('/scenarios/b/setup');
  });

  it('picks the attempt with most criteria met, ties to the latest', () => {
    const entry = (id: string, passedCount: number) => ({
      id,
      startedAt: '',
      completedAt: '',
      passed: passedCount === 3,
      passedCount,
      totalCount: 3,
      judgeUnavailable: false,
      metrics: { wpm: 0, fillersPerMinute: 0, longestPauseSec: 0, durationSec: 0 },
    });
    const groups: AttemptHistoryGroup[] = [
      {
        scenario: { id: 'a', title: 'A', track: 'fundamentals' },
        attempts: [entry('newest', 2), entry('middle', 2), entry('oldest', 1)],
        trend: { wpm: [], fillersPerMinute: [], longestPauseSec: [], durationSec: [] },
        targets: {},
      },
    ];
    expect(bestResults(groups).get('a')).toEqual({ attemptId: 'newest', passed: false, passedCount: 2, totalCount: 3 });
  });
});
