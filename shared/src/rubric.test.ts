import { describe, expect, it } from 'vitest';
import type { MetricValues, PaceWindow } from './domain';
import { ScoringInputError } from './errors';
import {
  buildVerdict,
  DEFAULT_EVIDENCE_NO_PASS,
  defaultEvidence,
  defaultNextAction,
  evaluateObjective,
  firstSentence,
  formatMetricValue,
  paceDriftRanges,
  passRule,
} from './rubric';
import type { ObjectiveCriterion, Rubric } from './scenario';

const objective: ObjectiveCriterion[] = [
  { id: 'fillers', label: 'Filler words', metric: 'fillersPerMinute', op: 'lte', value: 4 },
  { id: 'pace', label: 'Speaking pace', metric: 'wpm', op: 'between', value: [120, 170] },
  { id: 'pauses', label: 'Long pauses', metric: 'longestPauseSec', op: 'lte', value: 4 },
  { id: 'duration', label: 'Length', metric: 'durationSec', op: 'between', value: [45, 130] },
];

const rubric: Rubric = {
  objective,
  judged: [{ id: 'structure', label: 'Structure', criterion: 'Covers who, what, a detail, clean close.' }],
};

const metrics = (over: Partial<MetricValues> = {}): MetricValues => ({
  fillersPerMinute: 2,
  wpm: 150,
  longestPauseSec: 1.5,
  durationSec: 80,
  pauseCount2s: 0,
  ...over,
});

describe('evaluateObjective', () => {
  it('passes values inside every target, inclusive at the bounds', () => {
    const results = evaluateObjective(objective, metrics({ fillersPerMinute: 4, wpm: 170, durationSec: 45 }));
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('fails values outside the target and describes them plainly', () => {
    const results = evaluateObjective(objective, metrics({ wpm: 184 }));
    const pace = results.find((r) => r.id === 'pace');
    expect(pace?.passed).toBe(false);
    expect(pace?.detail).toBe('184 wpm, target 120-170 wpm');
    expect(pace?.actual).toBe(184);
    expect(pace?.kind).toBe('objective');
  });

  it('supports gte', () => {
    const [r] = evaluateObjective(
      [{ id: 'len', label: 'Length', metric: 'durationSec', op: 'gte', value: 30 }],
      metrics({ durationSec: 29.9 }),
    );
    expect(r?.passed).toBe(false);
    expect(r?.target).toBe('at least 30s');
  });

  it('supports pauseCount2s', () => {
    const [r] = evaluateObjective(
      [{ id: 'p', label: 'Pauses', metric: 'pauseCount2s', op: 'lte', value: 1 }],
      metrics({ pauseCount2s: 2 }),
    );
    expect(r?.passed).toBe(false);
  });

  it('throws when a metric value is missing', () => {
    const broken = { ...metrics(), wpm: Number.NaN };
    expect(() => evaluateObjective(objective, broken)).toThrow(ScoringInputError);
  });
});

describe('passRule', () => {
  const crit = (...passed: boolean[]) => passed.map((p) => ({ passed: p }));

  it('passes 5 of 5 and 4 of 5', () => {
    expect(passRule(crit(true, true, true, true, true))).toEqual({ passedCount: 5, totalCount: 5, passed: true });
    expect(passRule(crit(true, true, false, true, true)).passed).toBe(true);
  });

  it('fails 3 of 5', () => {
    expect(passRule(crit(true, false, false, true, true))).toEqual({ passedCount: 3, totalCount: 5, passed: false });
  });

  it('applies "at most one fails" to other counts', () => {
    expect(passRule(crit(false)).passed).toBe(true);
    expect(passRule(crit(true, false)).passed).toBe(true);
    expect(passRule(crit(false, false)).passed).toBe(false);
    expect(passRule(crit(true, true, true, true, true, false)).passed).toBe(true);
    expect(passRule(crit(true, true, true, true, false, false)).passed).toBe(false);
  });

  it('throws on zero criteria', () => {
    expect(() => passRule([])).toThrow(ScoringInputError);
  });
});

describe('buildVerdict', () => {
  it('combines objective and judged results', () => {
    const v = buildVerdict({
      rubric,
      metrics: metrics({ wpm: 190 }),
      judge: {
        outcomes: [{ id: 'structure', passed: true }],
        evidence: 'You opened with your name and course.',
        nextAction: 'Slow down in the middle section. Also breathe.',
      },
    });
    expect(v.totalCount).toBe(5);
    expect(v.passedCount).toBe(4);
    expect(v.passed).toBe(true);
    expect(v.judgeUnavailable).toBe(false);
    expect(v.nextAction).toBe('Slow down in the middle section.');
    expect(v.criteria.find((c) => c.id === 'structure')?.detail).toBe('You opened with your name and course.');
  });

  it('lets the judged criterion be the one that fails', () => {
    const v = buildVerdict({
      rubric,
      metrics: metrics(),
      judge: { outcomes: [{ id: 'structure', passed: false }], evidence: 'e', nextAction: 'n.' },
    });
    expect(v.passed).toBe(true);
    expect(v.passedCount).toBe(4);
  });

  it('auto-passes judged criteria when the judge is unavailable', () => {
    const v = buildVerdict({ rubric, metrics: metrics({ wpm: 100, fillersPerMinute: 9 }), judge: null });
    expect(v.judgeUnavailable).toBe(true);
    expect(v.criteria.find((c) => c.id === 'structure')?.passed).toBe(true);
    expect(v.passed).toBe(false);
    expect(v.nextAction.length).toBeGreaterThan(0);
    // The report still leads with a strength: the best passing metric.
    expect(v.evidence).toBe('Your answer ran 80s, inside the 45-130s target.');
  });

  it('treats a judged criterion missing from the judge output as passed', () => {
    const v = buildVerdict({ rubric, metrics: metrics(), judge: { outcomes: [], evidence: 'e', nextAction: 'n.' } });
    expect(v.criteria.find((c) => c.id === 'structure')?.passed).toBe(true);
  });
});

describe('defaultEvidence', () => {
  it('names the passing criterion with the most margin inside its target', () => {
    // fillers 2/4 (0.5), pace 145 (centre: 1), pause 1.5/4 (0.625), duration 80 (0.6)
    expect(defaultEvidence(objective, metrics({ wpm: 145 }))).toBe('Your pace held at 145 wpm, inside the 120-170 wpm target.');
  });

  it('uses "within the target of" for one-sided targets', () => {
    expect(defaultEvidence(objective, metrics({ fillersPerMinute: 0, wpm: 120, durationSec: 45 }))).toBe(
      'You kept fillers to 0.0 per minute, within the target of at most 4 per minute.',
    );
  });

  it('never names a failing criterion', () => {
    const line = defaultEvidence(objective, metrics({ fillersPerMinute: 9, wpm: 200, durationSec: 20, longestPauseSec: 3 }));
    expect(line).toBe('Your longest pause was 3.0s, within the target of at most 4s.');
  });

  it('falls back to a fixed strength when nothing passed', () => {
    const line = defaultEvidence(objective, metrics({ fillersPerMinute: 9, wpm: 200, durationSec: 20, longestPauseSec: 6 }));
    expect(line).toBe(DEFAULT_EVIDENCE_NO_PASS);
  });
});

describe('defaultNextAction', () => {
  it('advises on the first failing criterion and its direction', () => {
    expect(defaultNextAction(objective, metrics({ wpm: 100 }))).toMatch(/pick up the pace/i);
    expect(defaultNextAction(objective, metrics({ wpm: 200 }))).toMatch(/slow down/i);
    expect(defaultNextAction(objective, metrics({ durationSec: 20 }))).toMatch(/add one more/i);
    expect(defaultNextAction(objective, metrics({ fillersPerMinute: 8 }))).toMatch(/pause silently/i);
  });

  it('has a neutral line when everything passes', () => {
    expect(defaultNextAction(objective, metrics())).toMatch(/again/i);
  });
});

describe('firstSentence', () => {
  it('keeps only the first sentence', () => {
    expect(firstSentence('Do this. Then that.')).toBe('Do this.');
    expect(firstSentence('  No terminator  ')).toBe('No terminator');
    expect(firstSentence('Use 2.5 seconds max! Next.')).toBe('Use 2.5 seconds max!');
  });

  it('does not stop at an abbreviation inside the sentence', () => {
    expect(firstSentence('Close with a clear line, e.g. "That is me." Then stop.')).toBe('Close with a clear line, e.g. "That is me."');
    expect(firstSentence('Name one result, i.e. a number. More.')).toBe('Name one result, i.e. a number.');
    expect(firstSentence('Ask Dr. Smith first. Then go.')).toBe('Ask Dr. Smith first.');
  });

  it('keeps a closing quote that follows the terminator', () => {
    expect(firstSentence('Say "I built it." Then explain.')).toBe('Say "I built it."');
  });
});

describe('formatMetricValue', () => {
  it('formats units', () => {
    expect(formatMetricValue('wpm', 184.4)).toBe('184 wpm');
    expect(formatMetricValue('longestPauseSec', 3.25)).toBe('3.3s');
    expect(formatMetricValue('fillersPerMinute', 1.46)).toBe('1.5 per minute');
  });
});

describe('paceDriftRanges', () => {
  const w = (start: number, end: number, wpm: number, turnIndex = 0): PaceWindow => ({
    turnIndex,
    start,
    end,
    wpm,
    partial: end - start < 10,
  });

  it('merges consecutive out-of-range windows in the same direction', () => {
    const ranges = paceDriftRanges([w(0, 10, 150), w(10, 20, 190), w(20, 30, 200), w(30, 40, 100)], [120, 170]);
    expect(ranges).toEqual([
      { turnIndex: 0, start: 10, end: 30, direction: 'fast' },
      { turnIndex: 0, start: 30, end: 40, direction: 'slow' },
    ]);
  });

  it('ignores short tail windows and does not merge across turns', () => {
    const ranges = paceDriftRanges([w(0, 10, 200), w(10, 12, 300), w(0, 10, 200, 1)], [120, 170]);
    expect(ranges).toEqual([
      { turnIndex: 0, start: 0, end: 10, direction: 'fast' },
      { turnIndex: 1, start: 0, end: 10, direction: 'fast' },
    ]);
  });
});
