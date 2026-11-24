import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CALIBRATION_SCENARIO_ID, GOAL_OPTIONS, OTHER_GOAL_ID, trackForGoal, type TrackId } from '@rehearsal/shared';
import { loadScenarioDir } from '../src/content/loadScenarios';
import {
  DEFAULT_PATH_LENGTH,
  defaultPath,
  effectiveGoalTrack,
  generatePath,
  pathLengthBounds,
  pathViolations,
  repairPath,
  requiredGoalCount,
  type PathLibraryItem,
} from '../src/services/path';
import type { PathCandidate, PathGenerationInput } from '../src/services/claude';

vi.mock('../src/services/claude', () => ({ proposePath: vi.fn() }));

const CONTENT_DIR = path.resolve(__dirname, '../../content/scenarios');
const realLibrary: PathCandidate[] = loadScenarioDir(CONTENT_DIR)
  .store.list()
  .map((s) => ({ id: s.id, track: s.track, title: s.title, difficulty: s.difficulty, description: s.description ?? '' }));

const ALL_GOALS = [...GOAL_OPTIONS.map((g) => g.id), OTHER_GOAL_ID];

function item(id: string, track: TrackId, difficulty: number): PathLibraryItem {
  return { id, track, difficulty };
}

/** A synthetic library: calibration plus n scenarios per listed track, difficulties cycling 1..5. */
function syntheticLibrary(perTrack: Partial<Record<TrackId, number>>): PathLibraryItem[] {
  const items: PathLibraryItem[] = [item(CALIBRATION_SCENARIO_ID, 'fundamentals', 1)];
  for (const [track, n] of Object.entries(perTrack) as [TrackId, number][]) {
    for (let i = 0; i < n; i += 1) items.push(item(`${track}-${i}`, track, (i % 5) + 1));
  }
  return items;
}

function profileFor(goal: string): PathGenerationInput['profile'] {
  return { goal, goalDetail: goal === OTHER_GOAL_ID ? 'A debate' : '', timeframe: 'this-month', field: 'Biology', confidence: 3 };
}

function expectValid(ids: readonly string[], library: readonly PathLibraryItem[], goal: string): void {
  expect(pathViolations(ids, library, effectiveGoalTrack(goal, library))).toEqual([]);
}

/** Deterministic PRNG so the fuzz cases are reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('library assumptions', () => {
  it('loads the twelve scenarios across two tracks', () => {
    expect(realLibrary).toHaveLength(12);
    expect(new Set(realLibrary.map((s) => s.track))).toEqual(new Set(['fundamentals', 'professional']));
  });
});

describe('pathLengthBounds and requiredGoalCount', () => {
  it('uses 8-12 for a full library and the whole library when it is smaller', () => {
    expect(pathLengthBounds(12)).toEqual({ min: 8, max: 12 });
    expect(pathLengthBounds(30)).toEqual({ min: 8, max: 12 });
    expect(pathLengthBounds(5)).toEqual({ min: 5, max: 5 });
  });

  it('requires 60% rounded up, capped by availability', () => {
    expect(requiredGoalCount(8, 10)).toBe(5);
    expect(requiredGoalCount(10, 10)).toBe(6);
    expect(requiredGoalCount(12, 10)).toBe(8);
    expect(requiredGoalCount(10, 3)).toBe(3);
  });
});

describe('effectiveGoalTrack', () => {
  it('keeps the goal track when it has enough content', () => {
    expect(effectiveGoalTrack('job-interview', realLibrary)).toBe('professional');
    expect(effectiveGoalTrack('workplace', realLibrary)).toBe('professional');
    expect(effectiveGoalTrack('general', realLibrary)).toBe('fundamentals');
  });

  it('falls back to fundamentals for goals whose track is not built yet', () => {
    for (const goal of ['viva', 'presentation', 'social', OTHER_GOAL_ID]) {
      expect(effectiveGoalTrack(goal, realLibrary)).toBe('fundamentals');
    }
  });

  it('uses the largest track when neither the goal track nor fundamentals has enough', () => {
    const library = syntheticLibrary({ stage: 9, academic: 2 });
    expect(effectiveGoalTrack('viva', library)).toBe('stage');
  });

  it('uses the goal track once it is built', () => {
    const library = syntheticLibrary({ fundamentals: 6, academic: 7 });
    expect(effectiveGoalTrack('viva', library)).toBe('academic');
  });
});

describe('pathViolations', () => {
  const library = syntheticLibrary({ fundamentals: 5, professional: 8 });

  it('accepts a valid path', () => {
    const ids = [CALIBRATION_SCENARIO_ID, 'professional-0', 'professional-5', 'professional-1', 'professional-6', 'fundamentals-1', 'professional-2', 'professional-7'];
    expect(pathViolations(ids, library, 'professional')).toEqual([]);
  });

  it('reports each broken rule', () => {
    expect(pathViolations(['professional-0', CALIBRATION_SCENARIO_ID], library, 'professional')).toEqual(
      expect.arrayContaining(['starts-with-calibration', 'length']),
    );
    expect(pathViolations([CALIBRATION_SCENARIO_ID, 'nope'], library, 'professional')).toContain('unknown-id');
    expect(pathViolations([CALIBRATION_SCENARIO_ID, 'professional-0', 'professional-0'], library, 'professional')).toContain(
      'duplicate',
    );
    expect(pathViolations([CALIBRATION_SCENARIO_ID, 'professional-2', 'professional-1'], library, 'professional')).toContain(
      'ascending',
    );
    expect(pathViolations([CALIBRATION_SCENARIO_ID, 'professional-3'], library, 'professional')).toContain('difficulty-step');
    const fundamentalsHeavy = [CALIBRATION_SCENARIO_ID, 'fundamentals-0', 'fundamentals-1', 'fundamentals-2', 'professional-2', 'fundamentals-3', 'professional-3', 'fundamentals-4'];
    expect(pathViolations(fundamentalsHeavy, library, 'professional')).toContain('goal-share');
  });
});

describe('defaultPath', () => {
  it.each(ALL_GOALS)('is valid for goal %s on the real library', (goal) => {
    const ids = defaultPath(realLibrary, goal);
    expect(ids).toHaveLength(DEFAULT_PATH_LENGTH);
    expect(ids[0]).toBe(CALIBRATION_SCENARIO_ID);
    expectValid(ids, realLibrary, goal);
  });

  it('puts every professional scenario on an interview path, in ascending difficulty', () => {
    const ids = defaultPath(realLibrary, 'job-interview');
    expect(ids).toEqual([
      'self-introduction',
      'standup-update',
      'strengths-and-weaknesses',
      'explain-something-you-built',
      'tell-me-about-yourself',
      'explain-a-delay',
      'explain-a-decision',
      'disagree-with-a-senior-person',
      'give-difficult-feedback',
      'salary-or-offer-conversation',
    ]);
  });

  it('is deterministic', () => {
    expect(defaultPath(realLibrary, 'viva')).toEqual(defaultPath(realLibrary, 'viva'));
  });

  it('returns the whole library when it is smaller than the minimum', () => {
    const library = syntheticLibrary({ fundamentals: 3, professional: 1 });
    const ids = defaultPath(library, 'job-interview');
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe(CALIBRATION_SCENARIO_ID);
    expectValid(ids, library, 'job-interview');
  });

  it('works without a calibration scenario in the library', () => {
    const library = syntheticLibrary({ fundamentals: 10 }).filter((s) => s.id !== CALIBRATION_SCENARIO_ID);
    const ids = defaultPath(library, 'general');
    expect(ids).toHaveLength(DEFAULT_PATH_LENGTH);
    expectValid(ids, library, 'general');
  });

  it('bridges a difficulty gap in the goal track from other tracks', () => {
    const library = [
      item(CALIBRATION_SCENARIO_ID, 'fundamentals', 1),
      ...[1, 1, 4, 4, 5, 5].map((d, i) => item(`p${i}`, 'professional', d)),
      ...[2, 3, 3].map((d, i) => item(`f${i}`, 'fundamentals', d)),
    ];
    const ids = defaultPath(library, 'job-interview');
    expectValid(ids, library, 'job-interview');
  });
});

describe('repairPath', () => {
  const goal = 'job-interview';

  it('keeps a valid proposal unchanged', () => {
    const proposal = defaultPath(realLibrary, goal);
    expect(repairPath(proposal, realLibrary, goal)).toEqual(proposal);
    const shorter = proposal.filter((id) => id !== 'explain-a-decision');
    expect(repairPath(shorter, realLibrary, goal)).toEqual(shorter);
  });

  it('moves self-introduction to the front, or adds it', () => {
    const withoutCalibration = defaultPath(realLibrary, goal).slice(1);
    const repaired = repairPath(withoutCalibration, realLibrary, goal);
    expect(repaired?.[0]).toBe(CALIBRATION_SCENARIO_ID);
    const reordered = [...withoutCalibration.slice(0, 4), CALIBRATION_SCENARIO_ID, ...withoutCalibration.slice(4)];
    expect(repairPath(reordered, realLibrary, goal)?.[0]).toBe(CALIBRATION_SCENARIO_ID);
  });

  it('drops unknown ids and duplicates, then fills from the goal track by ascending difficulty', () => {
    const repaired = repairPath(['self-introduction', 'made-up', 'standup-update', 'standup-update', 'also-fake'], realLibrary, goal);
    expect(repaired).not.toBeNull();
    expect(repaired).not.toContain('made-up');
    expect(new Set(repaired)).toHaveProperty('size', repaired?.length);
    expect(repaired?.length).toBe(8);
    // Every professional scenario except the hardest comes first, by ascending difficulty.
    expect(repaired).toEqual(expect.arrayContaining(['strengths-and-weaknesses', 'explain-a-delay', 'disagree-with-a-senior-person']));
    expectValid(repaired ?? [], realLibrary, goal);
  });

  it('sorts an out-of-order proposal by difficulty', () => {
    const proposal = [...defaultPath(realLibrary, goal)].reverse();
    const repaired = repairPath(proposal, realLibrary, goal);
    expectValid(repaired ?? [], realLibrary, goal);
  });

  it('trims a proposal that is too long', () => {
    const proposal = realLibrary.map((s) => s.id);
    const repaired = repairPath(proposal, realLibrary, goal);
    expect(repaired).not.toBeNull();
    expect(repaired?.length).toBeLessThanOrEqual(12);
    expectValid(repaired ?? [], realLibrary, goal);
  });

  it('tops up the goal-track share by swapping out non-goal items', () => {
    const fundamentalsOnly = realLibrary.filter((s) => s.track === 'fundamentals').map((s) => s.id);
    const proposal = [...fundamentalsOnly, 'standup-update', 'strengths-and-weaknesses'];
    const repaired = repairPath(proposal, realLibrary, goal);
    expect(repaired).not.toBeNull();
    const professional = (repaired ?? []).filter((id) => realLibrary.find((s) => s.id === id)?.track === 'professional');
    expect(professional.length).toBeGreaterThanOrEqual(Math.ceil(0.6 * (repaired?.length ?? 0)));
    expectValid(repaired ?? [], realLibrary, goal);
  });

  it('returns a valid path from an empty proposal', () => {
    const repaired = repairPath([], realLibrary, goal);
    expectValid(repaired ?? [], realLibrary, goal);
  });

  it('returns null for an empty library', () => {
    expect(repairPath(['self-introduction'], [], goal)).toBeNull();
  });

  it('returns null when a difficulty gap cannot be bridged', () => {
    const library = [
      item(CALIBRATION_SCENARIO_ID, 'fundamentals', 1),
      ...Array.from({ length: 9 }, (_, i) => item(`f${i}`, 'fundamentals', 5)),
    ];
    expect(repairPath(library.map((s) => s.id), library, 'general')).toBeNull();
  });

  it.each(ALL_GOALS)('always yields a valid path or null for random proposals (goal %s)', (goalId) => {
    const random = rng(goalId.length * 7919);
    const ids = [...realLibrary.map((s) => s.id), 'unknown-a', 'unknown-b'];
    for (let run = 0; run < 300; run += 1) {
      const length = Math.floor(random() * 16);
      const proposal = Array.from({ length }, () => ids[Math.floor(random() * ids.length)] ?? 'unknown-a');
      const repaired = repairPath(proposal, realLibrary, goalId);
      expect(repaired).not.toBeNull();
      expectValid(repaired ?? [], realLibrary, goalId);
    }
  });

  it('fills academic, stage and social goals from the tracks that exist', () => {
    for (const goalId of ['viva', 'presentation', 'social']) {
      expect(trackForGoal(goalId)).not.toBe('fundamentals');
      const repaired = repairPath(['self-introduction'], realLibrary, goalId);
      expectValid(repaired ?? [], realLibrary, goalId);
    }
  });
});

describe('generatePath', () => {
  const request = (goal: string): Omit<PathGenerationInput, 'goalTrack'> => ({
    profile: profileFor(goal),
    baseline: null,
    library: realLibrary,
  });

  it('uses a repairable Claude proposal and passes the effective goal track', async () => {
    const propose = vi.fn(async () => defaultPath(realLibrary, 'job-interview').filter((id) => id !== 'explain-a-decision'));
    const result = await generatePath(request('job-interview'), propose);
    expect(result.fallback).toBe(false);
    expect(result.scenarioIds).toHaveLength(9);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ goalTrack: 'professional' }));
  });

  it('tells Claude the fallback track for an unbuilt goal track', async () => {
    const propose = vi.fn(async () => null);
    await generatePath(request('viva'), propose);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ goalTrack: 'fundamentals' }));
  });

  it.each([
    ['returns null', async () => null],
    ['throws', async () => Promise.reject(new Error('boom'))],
  ])('falls back to the default path when Claude %s', async (_label, impl) => {
    const result = await generatePath(request('workplace'), vi.fn(impl));
    expect(result).toEqual({ scenarioIds: defaultPath(realLibrary, 'workplace'), fallback: true });
  });

  it('falls back when the proposal cannot be repaired', async () => {
    const library = [
      item(CALIBRATION_SCENARIO_ID, 'fundamentals', 1),
      ...Array.from({ length: 9 }, (_, i) => item(`f${i}`, 'fundamentals', 5)),
    ].map((s) => ({ ...s, title: s.id, description: '' }));
    const result = await generatePath({ ...request('general'), library }, vi.fn(async () => library.map((s) => s.id)));
    expect(result.fallback).toBe(true);
    expect(result.scenarioIds[0]).toBe(CALIBRATION_SCENARIO_ID);
  });
});
