import { describe, expect, it, vi } from 'vitest';
import { MAX_GENERATED_WORDS, scenarioSchema, type UserProfile } from '@rehearsal/shared';
import { fallbackLine, produceTurnLine } from '../src/attempts/turnLine';
import { validScenario } from './fixtures';

const mocks = vi.hoisted(() => ({ generateTurnLine: vi.fn() }));

vi.mock('../src/services/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/claude')>()),
  generateTurnLine: mocks.generateTurnLine,
}));

const longGoalScenario = scenarioSchema.parse({
  ...validScenario(),
  brief: { scene: 'A quiet room.', yourGoal: 'Talk about {{topic}}.' },
  userInputs: [{ key: 'topic', label: 'Topic', type: 'text', maxLength: 2000 }],
});
const longTopic = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

describe('fallbackLine', () => {
  it('caps a turn-0 line built from a long interpolated goal at the word limit', () => {
    const line = fallbackLine(longGoalScenario, 0, { topic: longTopic });
    expect(line.startsWith("Let's begin.")).toBe(true);
    expect(wordCount(line)).toBeLessThanOrEqual(MAX_GENERATED_WORDS);
  });

  it('keeps a short line unchanged', () => {
    expect(fallbackLine(longGoalScenario, 0, { topic: 'my thesis' })).toBe("Let's begin. Talk about my thesis.");
  });
});

describe('produceTurnLine', () => {
  const profile: UserProfile = { goal: 'other', goalDetail: 'A pitch to my landlord', timeframe: 'this-month', field: 'Design', confidence: 3 };

  it('passes the goal detail to generation along with goal and field', async () => {
    mocks.generateTurnLine.mockResolvedValueOnce('Tell me about it.');
    await produceTurnLine({ scenario: longGoalScenario, turnIndex: 0, userInputs: { topic: 'rent' }, profile, previousTurns: [] });
    expect(mocks.generateTurnLine).toHaveBeenCalledWith(
      expect.objectContaining({ profile: { goal: 'other', goalDetail: 'A pitch to my landlord', field: 'Design' } }),
    );
  });

  it('uses a capped fallback when generation returns an empty line', async () => {
    mocks.generateTurnLine.mockResolvedValueOnce('   ');
    const line = await produceTurnLine({
      scenario: longGoalScenario,
      turnIndex: 0,
      userInputs: { topic: longTopic },
      profile: null,
      previousTurns: [],
    });
    expect(wordCount(line)).toBeLessThanOrEqual(MAX_GENERATED_WORDS);
  });
});
