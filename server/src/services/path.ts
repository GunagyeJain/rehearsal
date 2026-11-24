import {
  CALIBRATION_SCENARIO_ID,
  PATH_MAX_ITEMS,
  PATH_MIN_ITEMS,
  TRACK_IDS,
  trackForGoal,
  type TrackId,
} from '@rehearsal/shared';
import { proposePath as claudeProposePath, type PathGenerationInput } from './claude';

/**
 * Path generation rules (spec/scoring.md "Path generation"). Everything except generatePath is pure,
 * so the rules can be tested exhaustively without Claude.
 */

/** The fields of a library scenario the path rules look at. */
export interface PathLibraryItem {
  id: string;
  track: TrackId;
  difficulty: number;
}

export interface GeneratedPath {
  scenarioIds: string[];
  /** True when Claude failed or returned an unrepairable path and the default path was used. */
  fallback: boolean;
}

/** Share of the path that must come from the goal's track. */
export const GOAL_TRACK_SHARE = 0.6;
/** Largest allowed difficulty step between consecutive items. */
export const MAX_DIFFICULTY_STEP = 2;
/** Length of the deterministic default path. */
export const DEFAULT_PATH_LENGTH = 10;
/** The track used when the goal's own track has too little content (also the 'other' goal's track). */
export const FALLBACK_TRACK: TrackId = 'fundamentals';

export type PathRule =
  | 'starts-with-calibration'
  | 'unknown-id'
  | 'duplicate'
  | 'length'
  | 'ascending'
  | 'difficulty-step'
  | 'goal-share';

// ---------------------------------------------------------------- helpers

function countTrack(items: readonly PathLibraryItem[], track: TrackId): number {
  return items.filter((s) => s.track === track).length;
}

function byDifficulty<T extends PathLibraryItem>(items: readonly T[]): T[] {
  // Array.prototype.sort is stable, so ties keep their incoming order.
  return [...items].sort((a, b) => a.difficulty - b.difficulty);
}

/** Path length bounds for a library: a library smaller than the minimum yields every scenario it has. */
export function pathLengthBounds(librarySize: number): { min: number; max: number } {
  return { min: Math.min(PATH_MIN_ITEMS, librarySize), max: Math.min(PATH_MAX_ITEMS, librarySize) };
}

/** Goal-track items needed for a path of length n, capped at what the library holds in that track. */
export function requiredGoalCount(length: number, goalTrackAvailable: number): number {
  return Math.min(Math.ceil(GOAL_TRACK_SHARE * length), goalTrackAvailable);
}

/**
 * The track the 60% rule applies to. The goal's own track when the library holds enough of it to fill
 * 60% of a minimum-length path; otherwise Fundamentals; otherwise the largest track. This is how goals
 * whose track has no content yet (academic, social, stage) still get a valid path.
 */
export function effectiveGoalTrack(goal: string, library: readonly PathLibraryItem[]): TrackId {
  const needed = Math.ceil(GOAL_TRACK_SHARE * pathLengthBounds(library.length).min);
  const wanted = trackForGoal(goal);
  if (countTrack(library, wanted) >= needed) return wanted;
  if (countTrack(library, FALLBACK_TRACK) >= needed) return FALLBACK_TRACK;
  let best: TrackId = FALLBACK_TRACK;
  for (const track of TRACK_IDS) if (countTrack(library, track) > countTrack(library, best)) best = track;
  return best;
}

// ---------------------------------------------------------------- validation

/** Every rule a finished path breaks; empty when valid. */
export function pathViolations(
  ids: readonly string[],
  library: readonly PathLibraryItem[],
  goalTrack: TrackId,
): PathRule[] {
  const byId = new Map(library.map((s) => [s.id, s]));
  const violations = new Set<PathRule>();
  if (byId.has(CALIBRATION_SCENARIO_ID) && ids[0] !== CALIBRATION_SCENARIO_ID) violations.add('starts-with-calibration');
  if (new Set(ids).size !== ids.length) violations.add('duplicate');
  const known = ids.flatMap((id) => {
    const item = byId.get(id);
    if (!item) violations.add('unknown-id');
    return item ? [item] : [];
  });
  const bounds = pathLengthBounds(library.length);
  if (ids.length < bounds.min || ids.length > bounds.max) violations.add('length');
  known.forEach((item, i) => {
    const previous = known[i - 1];
    if (!previous) return;
    const step = item.difficulty - previous.difficulty;
    if (step < 0) violations.add('ascending');
    if (step > MAX_DIFFICULTY_STEP) violations.add('difficulty-step');
  });
  if (countTrack(known, goalTrack) < requiredGoalCount(known.length, countTrack(library, goalTrack))) {
    violations.add('goal-share');
  }
  return [...violations];
}

// ---------------------------------------------------------------- repair

/** Order the picked items: calibration first, then ascending difficulty (stable). */
function ordered(calibration: PathLibraryItem | undefined, rest: readonly PathLibraryItem[]): PathLibraryItem[] {
  return calibration ? [calibration, ...byDifficulty(rest)] : byDifficulty(rest);
}

/** Insert unused scenarios into difficulty gaps wider than MAX_DIFFICULTY_STEP, goal track first. */
function bridgeGaps(
  path: PathLibraryItem[],
  library: readonly PathLibraryItem[],
  goalTrack: TrackId,
): PathLibraryItem[] {
  const result = [...path];
  for (let i = 1; i < result.length; i += 1) {
    const low = result[i - 1]?.difficulty ?? 0;
    const high = result[i]?.difficulty ?? 0;
    if (high - low <= MAX_DIFFICULTY_STEP) continue;
    const used = new Set(result.map((s) => s.id));
    const candidates = library
      .filter((s) => !used.has(s.id) && s.difficulty > low && s.difficulty <= low + MAX_DIFFICULTY_STEP)
      .sort((a, b) => Number(b.track === goalTrack) - Number(a.track === goalTrack) || b.difficulty - a.difficulty);
    const bridge = candidates[0];
    if (!bridge) return result;
    result.splice(i, 0, bridge);
  }
  return result;
}

/**
 * Validate and repair proposed ids against the library (spec/scoring.md). Unknown ids and duplicates are
 * dropped, self-introduction is forced first, a short list is filled from the goal track by ascending
 * difficulty (then the other tracks), the goal-track share is topped up, the result is sorted by
 * difficulty and gaps are bridged. Returns null when the result still breaks a rule.
 */
export function repairPath(
  proposed: readonly string[],
  library: readonly PathLibraryItem[],
  goal: string,
): string[] | null {
  if (library.length === 0) return null;
  const goalTrack = effectiveGoalTrack(goal, library);
  const byId = new Map(library.map((s) => [s.id, s]));
  const calibration = byId.get(CALIBRATION_SCENARIO_ID);
  const bounds = pathLengthBounds(library.length);
  const restMax = bounds.max - (calibration ? 1 : 0);
  const restMin = bounds.min - (calibration ? 1 : 0);

  const seen = new Set<string>([CALIBRATION_SCENARIO_ID]);
  let rest: PathLibraryItem[] = [];
  for (const id of proposed) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    rest.push(item);
  }
  rest = rest.slice(0, restMax);

  const unused = (track?: TrackId): PathLibraryItem[] =>
    byDifficulty(library.filter((s) => !seen.has(s.id) && (track === undefined || s.track === track)));
  const take = (item: PathLibraryItem): void => {
    seen.add(item.id);
    rest.push(item);
  };

  // Fill a short list: goal track first, then everything else, both by ascending difficulty.
  for (const item of [...unused(goalTrack), ...unused()]) {
    if (rest.length >= restMin) break;
    if (!seen.has(item.id)) take(item);
  }

  // Top up the goal-track share: swap out the hardest non-goal item, or add when none is left to swap.
  const goalCount = (): number => countTrack(rest, goalTrack) + (calibration?.track === goalTrack ? 1 : 0);
  const available = countTrack(library, goalTrack);
  for (const item of unused(goalTrack)) {
    const length = rest.length + (calibration ? 1 : 0);
    if (goalCount() >= requiredGoalCount(length, available)) break;
    const nonGoal = byDifficulty(rest.filter((s) => s.track !== goalTrack)).pop();
    if (nonGoal) rest = rest.filter((s) => s.id !== nonGoal.id);
    if (nonGoal || rest.length < restMax) take(item);
  }

  const path = bridgeGaps(ordered(calibration, rest), library, goalTrack);
  const ids = path.map((s) => s.id);
  return pathViolations(ids, library, goalTrack).length === 0 ? ids : null;
}

/**
 * The deterministic default path (spec/api.md): self-introduction, then goal-track scenarios by ascending
 * difficulty, then Fundamentals, then any other track, trimmed to DEFAULT_PATH_LENGTH while keeping the
 * goal-track share, then ordered by difficulty. Used when Claude fails, so onboarding always completes.
 */
export function defaultPath(library: readonly PathLibraryItem[], goal: string): string[] {
  const goalTrack = effectiveGoalTrack(goal, library);
  const calibration = library.find((s) => s.id === CALIBRATION_SCENARIO_ID);
  const pool = library.filter((s) => s.id !== CALIBRATION_SCENARIO_ID);
  const goalPool = byDifficulty(pool.filter((s) => s.track === goalTrack));
  const fundamentalsPool = byDifficulty(pool.filter((s) => s.track === FALLBACK_TRACK && s.track !== goalTrack));
  const otherPool = byDifficulty(pool.filter((s) => s.track !== goalTrack && s.track !== FALLBACK_TRACK));
  const target = Math.min(DEFAULT_PATH_LENGTH, pathLengthBounds(library.length).max);
  const minimum = pathLengthBounds(library.length).min;
  const available = countTrack(library, goalTrack);

  const picked: PathLibraryItem[] = calibration ? [calibration] : [];
  for (const item of [...goalPool, ...fundamentalsPool, ...otherPool]) {
    if (picked.length >= target) break;
    const next = [...picked, item];
    const keepsShare = countTrack(next, goalTrack) >= requiredGoalCount(next.length, available);
    if (item.track === goalTrack || keepsShare || picked.length < minimum) picked.push(item);
  }
  const rest = picked.filter((s) => s !== calibration);
  return bridgeGaps(ordered(calibration, rest), library, goalTrack)
    .slice(0, pathLengthBounds(library.length).max)
    .map((s) => s.id);
}

// ---------------------------------------------------------------- generation

export type ProposePath = (input: PathGenerationInput) => Promise<string[] | null>;

/** Ask Claude for a path, then validate and repair it. Never rejects: any failure gives the default path. */
export async function generatePath(
  request: Omit<PathGenerationInput, 'goalTrack'>,
  propose: ProposePath = claudeProposePath,
): Promise<GeneratedPath> {
  const input: PathGenerationInput = { ...request, goalTrack: effectiveGoalTrack(request.profile.goal, request.library) };
  let proposed: string[] | null;
  try {
    proposed = await propose(input);
  } catch {
    proposed = null;
  }
  const repaired = proposed ? repairPath(proposed, input.library, input.profile.goal) : null;
  if (repaired) return { scenarioIds: repaired, fallback: false };
  return { scenarioIds: defaultPath(input.library, input.profile.goal), fallback: true };
}
