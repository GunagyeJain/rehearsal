// Spike 2 — metric extraction from a Whisper word array alone.
// Mirrors spec/scoring.md. Throwaway: the real implementation lands in
// server/src/services/scoring.ts in Phase 2.

// Unambiguous fillers. These always count.
const DEFINITE = [
  ['um'], ['uh'], ['umm'], ['uhh'], ['er'], ['erm'], ['ah'], ['hmm'], ['mmm'],
  ['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'], ['so', 'yeah'],
];

// Ambiguous. spec/scoring.md sends these to Claude with surrounding context to
// rule filler vs legitimate. The spike only counts and reports them separately so
// we can see how much they would swing the number.
const AMBIGUOUS = [['like'], ['basically'], ['actually'], ['right'], ['so']];

const normalise = (w) => w.toLowerCase().replace(/[^a-z']/g, '');

function matchAt(words, i, phrase) {
  if (i + phrase.length > words.length) return false;
  return phrase.every((part, k) => normalise(words[i + k].word) === part);
}

function findMarks(words, phrases) {
  const marks = [];
  let i = 0;
  while (i < words.length) {
    const hit = phrases.find((p) => matchAt(words, i, p));
    if (hit) {
      marks.push({
        word: hit.join(' '),
        index: i,
        start: words[i].start,
        end: words[i + hit.length - 1].end,
      });
      i += hit.length;
    } else {
      i += 1;
    }
  }
  return marks;
}

export function computeMetrics(words) {
  // spec/scoring.md: no estimation. Missing timestamps fail loudly.
  if (!Array.isArray(words) || words.length === 0) {
    throw new Error('No word array returned. Cannot score without word timestamps.');
  }
  const missing = words.filter((w) => typeof w.start !== 'number' || typeof w.end !== 'number');
  if (missing.length > 0) {
    throw new Error(`${missing.length} of ${words.length} words are missing start/end timestamps.`);
  }

  const definiteMarks = findMarks(words, DEFINITE);
  const ambiguousMarks = findMarks(words, AMBIGUOUS);

  const durationSec = words[words.length - 1].end - words[0].start;

  // Pauses: gap between word[i].end and word[i+1].start.
  const gaps = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const gap = words[i + 1].start - words[i].end;
    if (gap > 0) gaps.push({ start: words[i].end, end: words[i + 1].start, gap });
  }
  const pauseMarks = gaps.filter((g) => g.gap > 2);
  const longestPauseSec = gaps.reduce((max, g) => Math.max(max, g.gap), 0);

  // Speaking seconds excludes pauses over 2s.
  const speakingSec = durationSec - pauseMarks.reduce((sum, g) => sum + g.gap, 0);

  const fillerIndices = new Set();
  for (const m of definiteMarks) {
    const len = m.word.split(' ').length;
    for (let k = 0; k < len; k += 1) fillerIndices.add(m.index + k);
  }
  const contentWordCount = words.length - fillerIndices.size;

  const wpm = speakingSec > 0 ? (contentWordCount / speakingSec) * 60 : 0;
  const totalMin = durationSec / 60;
  const fillersPerMinute = totalMin > 0 ? definiteMarks.length / totalMin : 0;

  // Per 10s window, to check the "pace drifted here" band in the report design.
  const windows = [];
  const t0 = words[0].start;
  for (let start = 0; start < durationSec; start += 10) {
    const lo = t0 + start;
    const hi = lo + 10;
    const inWindow = words.filter((w, i) => w.start >= lo && w.start < hi && !fillerIndices.has(i));
    const span = Math.min(hi, words[words.length - 1].end) - lo;
    windows.push({
      fromSec: +start.toFixed(1),
      wpm: span > 0 ? +((inWindow.length / span) * 60).toFixed(1) : 0,
    });
  }

  return {
    firstWordStart: words[0].start, // waveform markers offset against this
    durationSec: +durationSec.toFixed(2),
    speakingSec: +speakingSec.toFixed(2),
    totalWords: words.length,
    contentWords: contentWordCount,
    wpm: +wpm.toFixed(1),
    fillersPerMinute: +fillersPerMinute.toFixed(2),
    fillerCount: definiteMarks.length,
    fillerMarks: definiteMarks,
    ambiguousCount: ambiguousMarks.length,
    ambiguousMarks,
    longestPauseSec: +longestPauseSec.toFixed(2),
    pauseCount2s: pauseMarks.length,
    pauseMarks: pauseMarks.map((g) => ({ start: +g.start.toFixed(2), end: +g.end.toFixed(2), gap: +g.gap.toFixed(2) })),
    wpmByWindow: windows,
  };
}
