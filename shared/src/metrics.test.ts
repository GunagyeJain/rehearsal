import { describe, expect, it } from 'vitest';
import type { Word } from './domain';
import { ScoringInputError } from './errors';
import { applyFillerRulings, computeAttemptMetrics, computeMetrics, paceWindows, wordsToTranscript } from './metrics';

/** Build words from "text@start-end" tokens, or evenly spaced words from a sentence. */
function spaced(text: string, start = 0, step = 0.4, len = 0.3): Word[] {
  return text.split(' ').map((word, i) => ({ word, start: start + i * step, end: start + i * step + len }));
}

describe('computeMetrics: validation', () => {
  it('throws NO_WORDS on an empty array', () => {
    expect(() => computeMetrics([])).toThrow(ScoringInputError);
    try {
      computeMetrics([]);
    } catch (e) {
      expect((e as ScoringInputError).code).toBe('NO_WORDS');
    }
  });

  it('throws MISSING_TIMESTAMPS when any word lacks start or end', () => {
    // Deliberately malformed input, as an upstream API might return.
    const words = [{ word: 'hi', start: 0, end: 0.2 }, { word: 'there' }] as unknown as Word[];
    expect(() => computeMetrics(words)).toThrow(/missing start\/end/);
  });

  it('throws INVALID_TIMESTAMPS when end is before start', () => {
    const words: Word[] = [{ word: 'hi', start: 1, end: 0.5 }];
    try {
      computeMetrics(words);
      expect.unreachable();
    } catch (e) {
      expect((e as ScoringInputError).code).toBe('INVALID_TIMESTAMPS');
    }
  });

  it('throws NaN timestamps as missing', () => {
    const words: Word[] = [{ word: 'hi', start: Number.NaN, end: 1 }];
    expect(() => computeMetrics(words)).toThrow(ScoringInputError);
  });

  it('throws when an attempt has no turns, or one turn is empty', () => {
    expect(() => computeAttemptMetrics([])).toThrow(ScoringInputError);
    expect(() => computeAttemptMetrics([spaced('hello there'), []])).toThrow(/Turn 1/);
  });
});

describe('computeMetrics: fillers', () => {
  it('counts definite fillers case-insensitively with punctuation stripped', () => {
    const { metrics } = computeMetrics(spaced('Um, I built it. UH... then shipped Hmm!'));
    expect(metrics.fillerCount).toBe(3);
    expect(metrics.fillerMarks.map((m) => m.word)).toEqual(['um', 'uh', 'hmm']);
  });

  it('matches multi-word fillers only on consecutive words', () => {
    const { metrics } = computeMetrics(spaced('you know I mean it sort of works you really know'));
    expect(metrics.fillerMarks.map((m) => m.word)).toEqual(['you know', 'i mean', 'sort of']);
    const youKnow = metrics.fillerMarks[0];
    expect(youKnow?.wordIndex).toBe(0);
    expect(youKnow?.wordCount).toBe(2);
    expect(youKnow?.start).toBe(0);
    expect(youKnow?.end).toBeCloseTo(0.7);
  });

  it('prefers "so yeah" over ambiguous "so"', () => {
    const { metrics, ambiguous } = computeMetrics(spaced('so yeah that is it so'));
    expect(metrics.fillerMarks.map((m) => m.word)).toEqual(['so yeah']);
    expect(ambiguous.map((a) => a.word)).toEqual(['so']);
  });

  it('returns ambiguous words as candidates and does not count them', () => {
    const { metrics, ambiguous } = computeMetrics(spaced('I basically like it right now actually'));
    expect(metrics.fillerCount).toBe(0);
    expect(ambiguous.map((a) => a.word)).toEqual(['basically', 'like', 'right', 'actually']);
    expect(ambiguous.map((a) => a.id)).toEqual([0, 1, 2, 3]);
    expect(ambiguous[1]?.context).toContain('[like]');
    expect(ambiguous[1]?.wordIndex).toBe(2);
  });

  it('includes surrounding words as context, bounded at the edges', () => {
    const { ambiguous } = computeMetrics(spaced('like the one before'));
    expect(ambiguous[0]?.context).toBe('[like] the one before');
  });

  it('does not match fillers inside other words', () => {
    const { metrics, ambiguous } = computeMetrics(spaced('umbrella likely rightly humming'));
    expect(metrics.fillerCount).toBe(0);
    expect(ambiguous).toHaveLength(0);
  });

  it('computes fillers per minute over total duration', () => {
    // 60 words over ~24s with 4 fillers.
    const text = Array.from({ length: 60 }, (_, i) => (i % 15 === 0 ? 'um' : 'word')).join(' ');
    const { metrics } = computeMetrics(spaced(text));
    expect(metrics.fillerCount).toBe(4);
    expect(metrics.durationSec).toBeCloseTo(23.9, 1);
    expect(metrics.fillersPerMinute).toBeCloseTo(4 / (23.9 / 60), 1);
  });
});

describe('applyFillerRulings', () => {
  it('counts only confirmed ambiguous words and excludes them from wpm', () => {
    const turns = [spaced('I like it like a lot basically')];
    const first = computeAttemptMetrics(turns);
    expect(first.ambiguous).toHaveLength(3);
    const after = applyFillerRulings(turns, first, [
      { id: 0, isFiller: false },
      { id: 1, isFiller: true },
      { id: 2, isFiller: true },
    ]);
    expect(after.fillerCount).toBe(2);
    expect(after.fillerMarks.map((m) => m.wordIndex)).toEqual([3, 6]);
    expect(after.contentWordCount).toBe(first.metrics.contentWordCount - 2);
    expect(after.wpm).toBeLessThan(first.metrics.wpm);
  });

  it('treats missing or unknown rulings as legitimate', () => {
    const turns = [spaced('like so')];
    const first = computeAttemptMetrics(turns);
    const after = applyFillerRulings(turns, first, [{ id: 99, isFiller: true }]);
    expect(after.fillerCount).toBe(0);
  });

  it('keeps definite fillers sorted alongside confirmed ones', () => {
    const turns = [spaced('like um basically')];
    const first = computeAttemptMetrics(turns);
    const after = applyFillerRulings(turns, first, [
      { id: 0, isFiller: true },
      { id: 1, isFiller: true },
    ]);
    expect(after.fillerMarks.map((m) => m.word)).toEqual(['like', 'um', 'basically']);
  });

  it('maps rulings across turns by candidate id', () => {
    const turns = [spaced('like this'), spaced('and like that')];
    const first = computeAttemptMetrics(turns);
    expect(first.ambiguous.map((a) => [a.id, a.turnIndex, a.wordIndex])).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    const after = applyFillerRulings(turns, first, [{ id: 1, isFiller: true }]);
    expect(after.fillerMarks).toEqual([expect.objectContaining({ turnIndex: 1, wordIndex: 1 })]);
  });
});

describe('computeMetrics: pauses', () => {
  const words: Word[] = [
    { word: 'one', start: 0, end: 0.5 },
    { word: 'two', start: 1.0, end: 1.5 }, // 0.5 gap
    { word: 'three', start: 4.0, end: 4.5 }, // 2.5 gap
    { word: 'four', start: 6.0, end: 6.5 }, // 1.5 gap
    { word: 'five', start: 11.0, end: 11.5 }, // 4.5 gap
  ];

  it('finds the longest pause and counts gaps over 2s', () => {
    const { metrics } = computeMetrics(words);
    expect(metrics.longestPauseSec).toBe(4.5);
    expect(metrics.pauseCount2s).toBe(2);
    expect(metrics.pauseMarks).toEqual([
      { start: 1.5, end: 4, durationSec: 2.5, turnIndex: 0, afterWordIndex: 1 },
      { start: 6.5, end: 11, durationSec: 4.5, turnIndex: 0, afterWordIndex: 3 },
    ]);
  });

  it('does not count a gap of exactly 2s as long', () => {
    const { metrics } = computeMetrics([
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 3, end: 4 },
    ]);
    expect(metrics.pauseCount2s).toBe(0);
    expect(metrics.longestPauseSec).toBe(2);
    expect(metrics.speakingSec).toBe(4);
  });

  it('ignores overlapping words (negative gaps)', () => {
    const { metrics } = computeMetrics([
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 0.8, end: 1.5 },
    ]);
    expect(metrics.longestPauseSec).toBe(0);
  });

  it('reports zero pause for a single word', () => {
    const { metrics } = computeMetrics([{ word: 'hello', start: 0.2, end: 0.9 }]);
    expect(metrics.longestPauseSec).toBe(0);
    expect(metrics.durationSec).toBe(0.7);
  });
});

describe('computeMetrics: wpm and duration', () => {
  it('measures duration from first word start to last word end', () => {
    const { metrics } = computeMetrics(spaced('a b c', 1.5, 1, 0.5));
    expect(metrics.durationSec).toBe(2.5);
  });

  it('excludes fillers from the word count and >2s pauses from speaking time', () => {
    const words: Word[] = [
      { word: 'um', start: 0, end: 0.5 },
      { word: 'one', start: 0.5, end: 1 },
      { word: 'two', start: 1, end: 1.5 },
      { word: 'three', start: 1.5, end: 2 },
      // 10s pause
      { word: 'four', start: 12, end: 12.5 },
      { word: 'five', start: 12.5, end: 13 },
    ];
    const { metrics } = computeMetrics(words);
    expect(metrics.durationSec).toBe(13);
    expect(metrics.speakingSec).toBe(3);
    expect(metrics.contentWordCount).toBe(5);
    expect(metrics.wpm).toBe(100);
  });

  it('keeps short pauses inside speaking time', () => {
    const words: Word[] = [
      { word: 'one', start: 0, end: 0.5 },
      { word: 'two', start: 2.0, end: 2.5 }, // 1.5s pause, kept
      { word: 'three', start: 2.5, end: 3 },
    ];
    const { metrics } = computeMetrics(words);
    expect(metrics.speakingSec).toBe(3);
    expect(metrics.wpm).toBe(60);
  });

  it('counts a multi-word filler once in fillers but excludes both words from wpm', () => {
    const { metrics } = computeMetrics(spaced('you know this works', 0, 0.5, 0.5));
    expect(metrics.fillerCount).toBe(1);
    expect(metrics.contentWordCount).toBe(2);
    expect(metrics.wordCount).toBe(4);
  });

  it('ignores punctuation-only tokens as words', () => {
    const { metrics } = computeMetrics([
      { word: 'hello', start: 0, end: 0.5 },
      { word: '...', start: 0.5, end: 0.6 },
      { word: 'there', start: 0.6, end: 1 },
    ]);
    expect(metrics.wordCount).toBe(2);
    expect(metrics.contentWordCount).toBe(2);
  });

  it('returns wpm 0 when there is no speaking time', () => {
    const { metrics } = computeMetrics([{ word: 'hi', start: 1, end: 1 }]);
    expect(metrics.wpm).toBe(0);
    expect(metrics.fillersPerMinute).toBe(0);
  });

  it('sums duration and speaking time across turns, excluding the time between answers', () => {
    const t0 = spaced('a b c d', 0, 0.5, 0.5); // 2s
    const t1 = spaced('e f', 5, 0.5, 0.5); // 1s, offsets are relative to its own audio
    const { metrics } = computeAttemptMetrics([t0, t1]);
    expect(metrics.durationSec).toBe(3);
    expect(metrics.wpm).toBe(120);
    expect(metrics.longestPauseSec).toBe(0);
  });

  it('takes the longest pause across turns and tags marks with their turn', () => {
    const t0: Word[] = [
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 4, end: 5 },
    ];
    const t1: Word[] = [
      { word: 'c', start: 0, end: 1 },
      { word: 'um', start: 6, end: 6.5 },
    ];
    const { metrics } = computeAttemptMetrics([t0, t1]);
    expect(metrics.longestPauseSec).toBe(5);
    expect(metrics.pauseCount2s).toBe(2);
    expect(metrics.pauseMarks.map((p) => p.turnIndex)).toEqual([0, 1]);
    expect(metrics.fillerMarks[0]).toMatchObject({ turnIndex: 1, wordIndex: 1, start: 6 });
  });
});

describe('paceWindows', () => {
  it('splits an answer into 10s windows relative to its audio', () => {
    // 50 words, one every 0.5s from t=1 -> last word ends at 25.8
    const words = spaced(Array.from({ length: 50 }, () => 'w').join(' '), 1, 0.5, 0.3);
    const windows = paceWindows(words);
    expect(windows.map((w) => [w.start, w.end])).toEqual([
      [1, 11],
      [11, 21],
      [21, 25.8],
    ]);
    expect(windows[0]?.wpm).toBe(120);
    expect(windows[2]?.partial).toBe(true);
    expect(windows[0]?.partial).toBe(false);
  });

  it('excludes filler word indices from window counts', () => {
    const words = spaced('um a b c', 0, 1, 0.5);
    const all = paceWindows(words);
    const withoutFiller = paceWindows(words, { fillerWordIndices: new Set([0]) });
    expect(withoutFiller[0]?.wpm).toBeLessThan(all[0]?.wpm ?? 0);
  });

  it('is included per turn in attempt metrics', () => {
    const { metrics } = computeAttemptMetrics([spaced('a b c'), spaced('d e')]);
    expect(metrics.paceWindows.map((w) => w.turnIndex)).toEqual([0, 1]);
  });

  it('throws on empty words', () => {
    expect(() => paceWindows([])).toThrow(ScoringInputError);
  });
});

describe('wordsToTranscript', () => {
  it('joins trimmed words with single spaces', () => {
    expect(wordsToTranscript([
      { word: ' Hello', start: 0, end: 1 },
      { word: 'world.', start: 1, end: 2 },
    ])).toBe('Hello world.');
  });
});
