import type { AttemptHistoryGroup, ScenarioListResponse, ScenarioSummary, TrackGroup, TrackId } from '@rehearsal/shared';

/** Pure filtering and best-result logic for Explore. */

export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5] as const;

const DIFFICULTY_LABELS: Readonly<Record<number, string>> = {
  1: 'Introductory',
  2: 'Easy',
  3: 'Moderate',
  4: 'Hard',
  5: 'Expert',
};

export function difficultyLabel(level: number): string {
  return DIFFICULTY_LABELS[level] ?? `Level ${level}`;
}

export interface BestResult {
  attemptId: string;
  passed: boolean;
  passedCount: number;
  totalCount: number;
}

/** Best scored attempt per scenario: most criteria met, ties to the latest. */
export function bestResults(groups: readonly AttemptHistoryGroup[]): Map<string, BestResult> {
  const best = new Map<string, BestResult>();
  for (const group of groups) {
    // Attempts are newest first, so the first one with the top count is the latest of the ties.
    const top = group.attempts.reduce<AttemptHistoryGroup['attempts'][number] | null>(
      (winner, attempt) => (!winner || attempt.passedCount > winner.passedCount ? attempt : winner),
      null,
    );
    if (top) {
      best.set(group.scenario.id, {
        attemptId: top.id,
        passed: top.passed,
        passedCount: top.passedCount,
        totalCount: top.totalCount,
      });
    }
  }
  return best;
}

export interface ExploreFilter {
  query: string;
  track: TrackId | 'all';
  difficulty: number | 'any';
}

export const EMPTY_FILTER: ExploreFilter = { query: '', track: 'all', difficulty: 'any' };

export function isFiltered(filter: ExploreFilter): boolean {
  return filter.query.trim() !== '' || filter.track !== 'all' || filter.difficulty !== 'any';
}

function matches(scenario: ScenarioSummary, filter: ExploreFilter): boolean {
  if (filter.difficulty !== 'any' && scenario.difficulty !== filter.difficulty) return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  return `${scenario.title} ${scenario.description}`.toLowerCase().includes(query);
}

/** Tracks that have content, in contract order. Empty tracks are not shown (content lives in JSON, never in code). */
export function tracksWithContent(list: ScenarioListResponse): TrackGroup[] {
  return list.tracks.filter((t) => t.scenarios.length > 0);
}

/** Apply the filter, dropping tracks left empty by it. */
export function filterTracks(tracks: readonly TrackGroup[], filter: ExploreFilter): TrackGroup[] {
  return tracks
    .filter((t) => filter.track === 'all' || t.track === filter.track)
    .map((t) => ({ ...t, scenarios: t.scenarios.filter((s) => matches(s, filter)) }))
    .filter((t) => t.scenarios.length > 0);
}

export function scenarioHref(scenario: Pick<ScenarioSummary, 'id' | 'hasSetup'>): string {
  return `/scenarios/${scenario.id}/${scenario.hasSetup ? 'setup' : 'brief'}`;
}
