import { describe, expect, it, vi } from 'vitest';
import { JUDGE_UNAVAILABLE_DETAIL, scenarioSchema, type Word } from '@rehearsal/shared';
import { scoreAttempt, scoreFirstPass } from '../src/services/scoring';
import { validScenario } from './fixtures';

// Never hit the network from this suite.
vi.mock('../src/services/claude', () => ({ judgeAttempt: vi.fn(async () => null) }));

const scenario = scenarioSchema.parse(validScenario());

/** ~140 wpm over 30s with one "um" and one ambiguous "so". */
function words(): Word[] {
  const out: Word[] = [{ word: 'So', start: 0, end: 0.2 }, { word: 'um', start: 0.4, end: 0.6 }];
  let t = 0.8;
  for (let i = 0; i < 68; i += 1) {
    out.push({ word: `word${i}`, start: t, end: t + 0.3 });
    t += 0.42;
  }
  return out;
}

const turns = [{ index: 0, aiText: 'Tell me about yourself.', transcript: 'So um ...', words: words() }];

describe('scoreFirstPass', () => {
  it('builds a provisional report and a judge input with id/word/context candidates', () => {
    const { provisional, judgeInput } = scoreFirstPass(scenario, turns);
    expect(provisional.objective).toHaveLength(scenario.rubric.objective.length);
    expect(judgeInput.criteria).toEqual(scenario.rubric.judged);
    for (const a of judgeInput.ambiguous) expect(Object.keys(a).sort()).toEqual(['context', 'id', 'word']);
  });

  it('throws when a turn has no timestamps', () => {
    const broken = [{ ...turns[0]!, words: [{ word: 'hi' } as unknown as Word] }];
    expect(() => scoreFirstPass(scenario, broken)).toThrow();
  });
});

describe('scoreAttempt', () => {
  it('judge null => judgeUnavailable and judged criteria auto-pass', async () => {
    const result = await scoreAttempt({ scenario, turns }, async () => null);
    expect(result.verdict.judgeUnavailable).toBe(true);
    const judged = result.verdict.criteria.filter((c) => c.kind === 'judged');
    expect(judged.length).toBeGreaterThan(0);
    for (const c of judged) {
      expect(c.passed).toBe(true);
      expect(c.detail).toBe(JUDGE_UNAVAILABLE_DETAIL);
    }
    expect(result.verdict.nextAction.length).toBeGreaterThan(0);
  });

  it('a throwing judge is treated as unavailable', async () => {
    const result = await scoreAttempt({ scenario, turns }, async () => Promise.reject(new Error('x')));
    expect(result.verdict.judgeUnavailable).toBe(true);
  });

  it('applies filler rulings from the judge to the final metrics', async () => {
    const first = scoreFirstPass(scenario, turns);
    const ids = first.judgeInput.ambiguous.map((a) => a.id);
    const result = await scoreAttempt({ scenario, turns }, async () => ({
      criteria: [{ id: 'structure', passed: false }],
      evidence: 'You named a concrete project.',
      nextAction: 'End on a clear closing line.',
      fillerRulings: ids.map((id) => ({ id, isFiller: true })),
    }));
    expect(result.verdict.judgeUnavailable).toBe(false);
    expect(result.metrics.fillerCount).toBe(first.provisional.metrics.fillerCount + ids.length);
    expect(result.verdict.criteria.find((c) => c.id === 'structure')?.passed).toBe(false);
    expect(result.provisional.metrics.fillerCount).toBe(first.provisional.metrics.fillerCount);
  });

  it('uses the default judge when none is injected', async () => {
    const result = await scoreAttempt({ scenario, turns });
    expect(result.verdict.judgeUnavailable).toBe(true);
  });
});
