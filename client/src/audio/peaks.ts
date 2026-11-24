import type { Word } from '@rehearsal/shared';

/**
 * Peak (amplitude envelope) data for the playback waveform: one value per bucket, 0..1.
 * Buckets hold RMS rather than the sample maximum, which tracks perceived loudness far better
 * than a single spike would. Normalised against a high percentile so one plosive cannot flatten
 * the rest of the answer.
 */

const NORMALISE_PERCENTILE = 0.98;

/** Mix channels down to mono by averaging. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (channel[i] ?? 0) / channels.length;
  }
  return out;
}

/** RMS of `samples` split into `buckets` equal spans. Empty input gives all zeros. */
export function bucketRms(samples: ArrayLike<number>, buckets: number): number[] {
  const count = Math.max(0, Math.floor(buckets));
  const out = new Array<number>(count).fill(0);
  if (count === 0 || samples.length === 0) return out;
  for (let b = 0; b < count; b += 1) {
    const from = Math.floor((b * samples.length) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * samples.length) / count));
    let sum = 0;
    for (let i = from; i < to; i += 1) {
      const s = samples[i] ?? 0;
      sum += s * s;
    }
    out[b] = Math.sqrt(sum / (to - from));
  }
  return out;
}

/** Scale so the given percentile maps to 1, clamping above. All-zero input stays all zeros. */
export function normalisePeaks(values: readonly number[], percentile = NORMALISE_PERCENTILE): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.round(percentile * (sorted.length - 1)));
  const reference = sorted[index] ?? 0;
  if (reference <= 0) return values.map(() => 0);
  return values.map((v) => Math.min(1, v / reference));
}

/**
 * Fit peaks to `count` bars. Downsampling takes the max of each span so short sounds (a filler)
 * never vanish; upsampling repeats the nearest value so bars stay honest to the data.
 */
export function resamplePeaks(peaks: readonly number[], count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  if (peaks.length === 0) return new Array<number>(n).fill(0);
  if (peaks.length === n) return [...peaks];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const from = Math.floor((i * peaks.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / n));
    let max = 0;
    for (let j = from; j < to; j += 1) max = Math.max(max, peaks[j] ?? 0);
    out[i] = max;
  }
  return out;
}

/** Pure core of computePeaks: decoded channel data -> normalised bucket envelope. */
export function peaksFromChannels(channels: readonly Float32Array[], buckets: number): number[] {
  return normalisePeaks(bucketRms(mixToMono(channels), buckets));
}

/**
 * A stand-in envelope from word timings alone, for a turn whose recording was deleted:
 * speech-height bars inside word spans, silence between. Deterministic per word so it never
 * flickers between renders.
 */
export function peaksFromWords(words: readonly Word[], durationSec: number, buckets: number): number[] {
  const n = Math.max(0, Math.floor(buckets));
  const out = new Array<number>(n).fill(0);
  if (n === 0 || durationSec <= 0) return out;
  words.forEach((word, wordIndex) => {
    const from = Math.max(0, Math.floor((word.start / durationSec) * n));
    const to = Math.min(n - 1, Math.ceil((word.end / durationSec) * n) - 1);
    for (let b = from; b <= to; b += 1) {
      const wobble = Math.abs(Math.sin((wordIndex + 1) * 12.9898 + b * 78.233)) % 1;
      out[b] = Math.max(out[b] ?? 0, 0.45 + wobble * 0.45);
    }
  });
  return out;
}

const DECODE_SAMPLE_RATE = 44_100;

function createDecoder(): BaseAudioContext {
  if (typeof OfflineAudioContext !== 'undefined') {
    // Length and rate do not matter: the context is only used for decodeAudioData, never rendered.
    return new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  }
  if (typeof AudioContext !== 'undefined') return new AudioContext();
  throw new Error('This browser cannot decode audio.');
}

export interface DecodedPeaks {
  peaks: number[];
  /** Length of the decoded media. This, not a wall-clock estimate, is the timeline markers sit on. */
  durationSec: number;
}

/** Decode a recording once: bar peaks plus its true duration. */
export async function decodePeaks(source: Blob | ArrayBuffer, buckets: number): Promise<DecodedPeaks> {
  const bytes = source instanceof ArrayBuffer ? source.slice(0) : await source.arrayBuffer();
  const decoder = createDecoder();
  try {
    const buffer = await decoder.decodeAudioData(bytes);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    return { peaks: peaksFromChannels(channels, buckets), durationSec: buffer.duration };
  } finally {
    if (decoder instanceof AudioContext) void decoder.close();
  }
}

/** Decode a recording and reduce it to `buckets` normalised peaks (0..1). */
export async function computePeaks(source: Blob | ArrayBuffer, buckets: number): Promise<number[]> {
  return (await decodePeaks(source, buckets)).peaks;
}
