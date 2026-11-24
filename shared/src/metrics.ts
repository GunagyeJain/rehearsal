import { AMBIGUOUS_CONTEXT_WORDS, LONG_PAUSE_SEC, PACE_WINDOW_SEC } from './constants';
import type {
  AmbiguousCandidate,
  FillerMark,
  FillerRuling,
  Metrics,
  MetricsAnalysis,
  PaceWindow,
  PauseMark,
  Word,
} from './domain';
import { ScoringInputError } from './errors';
import { AMBIGUOUS_FILLER_PHRASES, DEFINITE_FILLER_PHRASES, normaliseToken } from './fillers';

/**
 * Objective metrics from Whisper word timestamps — spec/scoring.md.
 * Pure functions; shared by server (scoring) and client (waveform rendering).
 */

export interface MetricsOptions {
  /**
   * Ambiguous candidates confirmed as fillers, as keys from candidateKey().
   * Leave empty for a first pass; use applyFillerRulings() after the judge rules.
   */
  confirmedFillers?: ReadonlySet<string>;
  longPauseSec?: number;
  paceWindowSec?: number;
  contextWords?: number;
}

interface PhraseMatch {
  phrase: readonly string[];
  wordIndex: number;
}

interface TurnAnalysis {
  durationSec: number;
  speakingSec: number;
  wordCount: number;
  contentWordCount: number;
  longestPauseSec: number;
  fillerMarks: FillerMark[];
  pauseMarks: PauseMark[];
  paceWindows: PaceWindow[];
  ambiguous: Omit<AmbiguousCandidate, 'id'>[];
}

/** Stable key for an ambiguous occurrence within an attempt. */
export function candidateKey(turnIndex: number, wordIndex: number): string {
  return `${turnIndex}:${wordIndex}`;
}

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Throws ScoringInputError unless every word has finite, ordered start/end timestamps. */
export function assertScorableWords(words: readonly Word[] | null | undefined, turnIndex = 0): asserts words is readonly Word[] {
  if (!Array.isArray(words) || words.length === 0) {
    throw new ScoringInputError('NO_WORDS', `Turn ${turnIndex}: no words returned. Cannot score without word timestamps.`);
  }
  const missing = words.filter(
    (w) => typeof w?.start !== 'number' || typeof w?.end !== 'number' || !Number.isFinite(w.start) || !Number.isFinite(w.end),
  ).length;
  if (missing > 0) {
    throw new ScoringInputError(
      'MISSING_TIMESTAMPS',
      `Turn ${turnIndex}: ${missing} of ${words.length} words are missing start/end timestamps.`,
    );
  }
  const backwards = words.findIndex((w) => w.end < w.start || w.start < 0);
  if (backwards !== -1) {
    throw new ScoringInputError('INVALID_TIMESTAMPS', `Turn ${turnIndex}: word ${backwards} has an invalid time range.`);
  }
}

function matchPhraseAt(tokens: readonly string[], i: number, phrases: readonly (readonly string[])[]): readonly string[] | null {
  for (const phrase of phrases) {
    if (i + phrase.length > tokens.length) continue;
    if (phrase.every((part, k) => tokens[i + k] === part)) return phrase;
  }
  return null;
}

/** Scan left to right; definite phrases (longest first) take precedence over ambiguous ones at the same position. */
function scanFillers(tokens: readonly string[]): { definite: PhraseMatch[]; ambiguous: PhraseMatch[] } {
  const definite: PhraseMatch[] = [];
  const ambiguous: PhraseMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    const d = matchPhraseAt(tokens, i, DEFINITE_FILLER_PHRASES);
    if (d) {
      definite.push({ phrase: d, wordIndex: i });
      i += d.length;
      continue;
    }
    const a = matchPhraseAt(tokens, i, AMBIGUOUS_FILLER_PHRASES);
    if (a) {
      ambiguous.push({ phrase: a, wordIndex: i });
      i += a.length;
      continue;
    }
    i += 1;
  }
  return { definite, ambiguous };
}

function contextFor(words: readonly Word[], start: number, count: number, span: number): string {
  const from = Math.max(0, start - span);
  const to = Math.min(words.length, start + count + span);
  const parts: string[] = [];
  for (let i = from; i < to; i += 1) {
    const w = words[i]?.word.trim() ?? '';
    if (i === start) parts.push(`[${w}`);
    else parts.push(w);
    if (i === start + count - 1) parts[parts.length - 1] = `${parts[parts.length - 1]}]`;
  }
  return parts.join(' ');
}

function toMark(words: readonly Word[], m: PhraseMatch, turnIndex: number): FillerMark {
  const first = words[m.wordIndex] as Word;
  const last = words[m.wordIndex + m.phrase.length - 1] as Word;
  return {
    word: m.phrase.join(' '),
    start: round(first.start, 2),
    end: round(last.end, 2),
    turnIndex,
    wordIndex: m.wordIndex,
    wordCount: m.phrase.length,
  };
}

/**
 * WPM per window for the waveform pace band. Filler words are excluded, matching the wpm definition.
 * Windows start at the first word and are relative to the turn's audio.
 */
export function paceWindows(
  words: readonly Word[],
  opts: { turnIndex?: number; windowSec?: number; fillerWordIndices?: ReadonlySet<number> } = {},
): PaceWindow[] {
  const turnIndex = opts.turnIndex ?? 0;
  assertScorableWords(words, turnIndex);
  const windowSec = opts.windowSec ?? PACE_WINDOW_SEC;
  const fillers = opts.fillerWordIndices ?? new Set<number>();
  const t0 = (words[0] as Word).start;
  const tEnd = (words[words.length - 1] as Word).end;
  const windows: PaceWindow[] = [];
  for (let lo = t0; lo < tEnd; lo += windowSec) {
    const hi = Math.min(lo + windowSec, tEnd);
    const span = hi - lo;
    let count = 0;
    words.forEach((w, i) => {
      if (w.start >= lo && w.start < lo + windowSec && !fillers.has(i)) count += 1;
    });
    windows.push({
      turnIndex,
      start: round(lo, 2),
      end: round(hi, 2),
      wpm: span > 0 ? round((count / span) * 60, 1) : 0,
      partial: span < windowSec,
    });
  }
  return windows;
}

function analyseTurn(words: readonly Word[], turnIndex: number, opts: MetricsOptions): TurnAnalysis {
  assertScorableWords(words, turnIndex);
  const longPause = opts.longPauseSec ?? LONG_PAUSE_SEC;
  const confirmed = opts.confirmedFillers ?? new Set<string>();
  const tokens = words.map((w) => normaliseToken(w.word));

  const { definite, ambiguous } = scanFillers(tokens);
  const confirmedAmbiguous = ambiguous.filter((m) => confirmed.has(candidateKey(turnIndex, m.wordIndex)));
  const pendingAmbiguous = ambiguous.filter((m) => !confirmed.has(candidateKey(turnIndex, m.wordIndex)));
  const fillerMatches = [...definite, ...confirmedAmbiguous].sort((a, b) => a.wordIndex - b.wordIndex);

  const fillerWordIndices = new Set<number>();
  for (const m of fillerMatches) {
    for (let k = 0; k < m.phrase.length; k += 1) fillerWordIndices.add(m.wordIndex + k);
  }
  // Words that normalise to nothing (stray punctuation tokens) are not words.
  const emptyTokens = tokens.filter((t, i) => t === '' && !fillerWordIndices.has(i)).length;

  const first = words[0] as Word;
  const last = words[words.length - 1] as Word;
  const durationSec = Math.max(0, last.end - first.start);

  let longestPauseSec = 0;
  let longPauseTotal = 0;
  const pauseMarks: PauseMark[] = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const gap = (words[i + 1] as Word).start - (words[i] as Word).end;
    if (gap <= 0) continue;
    longestPauseSec = Math.max(longestPauseSec, gap);
    if (gap > longPause) {
      longPauseTotal += gap;
      pauseMarks.push({
        start: round((words[i] as Word).end, 2),
        end: round((words[i + 1] as Word).start, 2),
        durationSec: round(gap, 2),
        turnIndex,
        afterWordIndex: i,
      });
    }
  }

  return {
    durationSec,
    speakingSec: Math.max(0, durationSec - longPauseTotal),
    wordCount: words.length - emptyTokens,
    contentWordCount: words.length - fillerWordIndices.size - emptyTokens,
    longestPauseSec,
    fillerMarks: fillerMatches.map((m) => toMark(words, m, turnIndex)),
    pauseMarks,
    paceWindows: paceWindows(words, { turnIndex, windowSec: opts.paceWindowSec, fillerWordIndices }),
    ambiguous: pendingAmbiguous.map((m) => {
      const mark = toMark(words, m, turnIndex);
      return {
        word: mark.word,
        turnIndex,
        wordIndex: m.wordIndex,
        wordCount: m.phrase.length,
        start: mark.start,
        end: mark.end,
        context: contextFor(words, m.wordIndex, m.phrase.length, opts.contextWords ?? AMBIGUOUS_CONTEXT_WORDS),
      };
    }),
  };
}

/**
 * Metrics for a multi-turn attempt. Each element of `turns` is one answer's word array,
 * with times relative to that answer's audio. Durations and speaking time are summed across
 * turns (the AI's speaking time between answers never counts); the longest pause is the max.
 */
export function computeAttemptMetrics(turns: readonly (readonly Word[])[], opts: MetricsOptions = {}): MetricsAnalysis {
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new ScoringInputError('NO_WORDS', 'No turns to score.');
  }
  const analysed = turns.map((words, i) => analyseTurn(words, i, opts));
  const sum = (pick: (t: TurnAnalysis) => number): number => analysed.reduce((acc, t) => acc + pick(t), 0);

  const durationSec = sum((t) => t.durationSec);
  const speakingSec = sum((t) => t.speakingSec);
  const contentWordCount = sum((t) => t.contentWordCount);
  const fillerMarks = analysed.flatMap((t) => t.fillerMarks);
  const pauseMarks = analysed.flatMap((t) => t.pauseMarks);
  const minutes = durationSec / 60;

  const metrics: Metrics = {
    wpm: speakingSec > 0 ? round((contentWordCount / speakingSec) * 60, 1) : 0,
    fillersPerMinute: minutes > 0 ? round(fillerMarks.length / minutes, 2) : 0,
    longestPauseSec: round(Math.max(...analysed.map((t) => t.longestPauseSec)), 2),
    pauseCount2s: pauseMarks.length,
    durationSec: round(durationSec, 2),
    speakingSec: round(speakingSec, 2),
    wordCount: sum((t) => t.wordCount),
    contentWordCount,
    fillerCount: fillerMarks.length,
    fillerMarks,
    pauseMarks,
    paceWindows: analysed.flatMap((t) => t.paceWindows),
  };
  const ambiguous: AmbiguousCandidate[] = analysed.flatMap((t) => t.ambiguous).map((c, id) => ({ ...c, id }));
  return { metrics, ambiguous };
}

/** Metrics for a single answer (onboarding baseline, single-turn scenarios). */
export function computeMetrics(words: readonly Word[], opts: MetricsOptions = {}): MetricsAnalysis {
  return computeAttemptMetrics([words], opts);
}

/**
 * Second pass after the judge rules on ambiguous words: confirmed fillers are counted
 * (and excluded from wpm). Rulings for unknown ids are ignored; candidates without a
 * ruling are treated as legitimate, so an incomplete judge reply never inflates the count.
 */
export function applyFillerRulings(
  turns: readonly (readonly Word[])[],
  firstPass: MetricsAnalysis,
  rulings: readonly FillerRuling[],
  opts: Omit<MetricsOptions, 'confirmedFillers'> = {},
): Metrics {
  const byId = new Map(firstPass.ambiguous.map((c) => [c.id, c]));
  const confirmed = new Set<string>();
  for (const r of rulings) {
    const c = byId.get(r.id);
    if (c && r.isFiller) confirmed.add(candidateKey(c.turnIndex, c.wordIndex));
  }
  return computeAttemptMetrics(turns, { ...opts, confirmedFillers: confirmed }).metrics;
}

/** Joined transcript text for one turn's words. */
export function wordsToTranscript(words: readonly Word[]): string {
  return words
    .map((w) => w.word.trim())
    .filter((w) => w !== '')
    .join(' ');
}
