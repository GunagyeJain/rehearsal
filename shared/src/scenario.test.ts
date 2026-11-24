import { describe, expect, it } from 'vitest';
import { derivePathItems, isPathComplete, type PathProgressInfo, type PathScenarioInfo } from './path';
import { interpolate, scenarioSchema, validateUserInputs, type ScenarioInput } from './scenario';
import { DEFINITE_FILLERS } from './fillers';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const valid: ScenarioInput = {
  id: 'self-introduction',
  track: 'fundamentals',
  title: 'Self-introduction',
  description: 'Introduce yourself to an interview panel.',
  difficulty: 1,
  userInputs: [{ key: 'field', label: 'What do you study?', type: 'text', placeholder: 'CS', required: true }],
  brief: { scene: 'An interview room.', yourGoal: 'Introduce yourself in under two minutes.' },
  turns: [
    {
      index: 0,
      speaker: 'ai',
      persona: 'Interviewer',
      generate: 'Greet and ask.',
      userResponse: { maxSeconds: 120, minSeconds: 30, silenceStopSeconds: 3 },
    },
    {
      index: 1,
      speaker: 'ai',
      persona: 'Interviewer',
      generate: 'Follow up.',
      dependsOnPreviousAnswer: true,
      userResponse: { maxSeconds: 90, minSeconds: 20, silenceStopSeconds: 3 },
    },
  ],
  rubric: {
    objective: [
      { id: 'fillers', label: 'Filler words', metric: 'fillersPerMinute', op: 'lte', value: 4 },
      { id: 'pace', label: 'Speaking pace', metric: 'wpm', op: 'between', value: [120, 170] },
    ],
    judged: [{ id: 'structure', label: 'Structure', criterion: 'Clean close.' }],
  },
  criteriaDisplay: ['Keep filler words under 4 per minute'],
};

describe('scenarioSchema', () => {
  it('accepts the spec example and applies defaults', () => {
    const s = scenarioSchema.parse(valid);
    expect(s.turns[0]?.dependsOnPreviousAnswer).toBe(false);
    expect(s.turns[1]?.dependsOnPreviousAnswer).toBe(true);
  });

  it('defaults userInputs to an empty array and strips unknown keys', () => {
    const { userInputs: _omit, ...rest } = valid;
    const s = scenarioSchema.parse({ ...rest, ends: 'editorial note' });
    expect(s.userInputs).toEqual([]);
    expect('ends' in s).toBe(false);
  });

  it('requires options on select inputs', () => {
    const bad = { ...valid, userInputs: [{ key: 'role', label: 'Role', type: 'select', options: [] }] };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
    const ok = { ...valid, userInputs: [{ key: 'role', label: 'Role', type: 'select', options: ['A', { value: 'b', label: 'B' }] }] };
    expect(scenarioSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects unknown metrics, bad between ranges and duplicate ids', () => {
    const badMetric = clone(valid) as Record<string, unknown>;
    (badMetric.rubric as { objective: unknown[] }).objective = [{ id: 'x', label: 'x', metric: 'loudness', op: 'lte', value: 1 }];
    expect(scenarioSchema.safeParse(badMetric).success).toBe(false);

    const badRange = clone(valid);
    badRange.rubric.objective = [{ id: 'pace', label: 'p', metric: 'wpm', op: 'between', value: [170, 120] }];
    expect(scenarioSchema.safeParse(badRange).success).toBe(false);

    const dup = clone(valid);
    dup.rubric.judged = [{ id: 'fillers', label: 'x', criterion: 'y' }];
    expect(scenarioSchema.safeParse(dup).success).toBe(false);
  });

  it('requires at least one judged criterion and at most four turns', () => {
    const noJudged = clone(valid);
    noJudged.rubric.judged = [];
    expect(scenarioSchema.safeParse(noJudged).success).toBe(false);

    const many = clone(valid);
    const t = many.turns[0];
    if (!t) throw new Error('fixture');
    many.turns = [0, 1, 2, 3, 4].map((index) => ({ ...t, index }));
    expect(scenarioSchema.safeParse(many).success).toBe(false);
  });

  it('requires sequential turn indices and no dependency on turn 0', () => {
    const gap = clone(valid);
    if (gap.turns[1]) gap.turns[1].index = 2;
    expect(scenarioSchema.safeParse(gap).success).toBe(false);

    const dep = clone(valid);
    if (dep.turns[0]) dep.turns[0].dependsOnPreviousAnswer = true;
    expect(scenarioSchema.safeParse(dep).success).toBe(false);
  });

  it('rejects difficulty outside 1-5 and non-kebab ids', () => {
    expect(scenarioSchema.safeParse({ ...valid, difficulty: 6 }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...valid, id: 'Self Intro' }).success).toBe(false);
  });
});

describe('interpolate / validateUserInputs', () => {
  it('fills known keys and leaves unknown ones visible', () => {
    expect(interpolate('Interview for {{role}} in {{ field }}', { role: 'SWE' })).toBe('Interview for SWE in {{ field }}');
  });

  it('validates required and select values', () => {
    const fields = [
      { key: 'field', label: 'Field', type: 'text' as const, required: true },
      { key: 'level', label: 'Level', type: 'select' as const, required: false, options: ['junior', 'senior'] },
    ];
    expect(validateUserInputs(fields, {})).toEqual({ field: 'Add an answer to continue.' });
    expect(validateUserInputs(fields, { field: 'x', level: 'cto' })).toEqual({ level: 'Choose one of the listed options' });
    expect(validateUserInputs(fields, { field: 'x', level: 'senior' })).toEqual({});
  });
});

describe('filler constants', () => {
  it('keeps ambiguous words out of the definite list', () => {
    expect(DEFINITE_FILLERS).not.toContain('like');
    expect(DEFINITE_FILLERS).toContain('so yeah');
    expect(DEFINITE_FILLERS).toContain('you know');
  });
});

describe('derivePathItems', () => {
  const ids = ['a', 'b', 'c'];
  const scenarios = new Map<string, PathScenarioInfo>(
    ids.map((id, i) => [id, { id, title: id.toUpperCase(), track: 'fundamentals', difficulty: i + 1 }]),
  );
  const prog = (status: PathProgressInfo['status'], attemptCount: number): PathProgressInfo => ({
    status,
    attemptCount,
    bestAttemptId: null,
    lastAttemptId: null,
  });

  it('unlocks only the first item on a fresh path', () => {
    const items = derivePathItems(ids, scenarios, new Map());
    expect(items.map((i) => i.state)).toEqual(['available', 'locked', 'locked']);
    expect(items[0]?.isCurrent).toBe(true);
  });

  it('unlocks the next item after a pass or skip', () => {
    const items = derivePathItems(ids, scenarios, new Map([['a', prog('passed', 1)], ['b', prog('skipped', 3)]]));
    expect(items.map((i) => i.state)).toEqual(['passed', 'skipped', 'available']);
    expect(items[2]?.isCurrent).toBe(true);
  });

  it('shows failed and offers skip from the third failed attempt', () => {
    const two = derivePathItems(ids, scenarios, new Map([['a', prog('failed', 2)]]));
    expect(two[0]?.state).toBe('failed');
    expect(two[0]?.canSkip).toBe(false);
    const three = derivePathItems(ids, scenarios, new Map([['a', prog('failed', 3)]]));
    expect(three[0]?.canSkip).toBe(true);
  });

  it('keeps an attempted-but-locked item locked, and a passed one passed even out of order', () => {
    const items = derivePathItems(ids, scenarios, new Map([['b', prog('failed', 1)], ['c', prog('passed', 1)]]));
    expect(items.map((i) => i.state)).toEqual(['available', 'locked', 'passed']);
  });

  it('reports completion when every item is passed or skipped', () => {
    const items = derivePathItems(ids, scenarios, new Map(ids.map((id) => [id, prog('passed', 1)])));
    expect(isPathComplete(items)).toBe(true);
    expect(items.some((i) => i.isCurrent)).toBe(false);
  });
});
