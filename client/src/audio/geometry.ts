import type { FillerMark, PaceDriftRange, PauseMark } from '@rehearsal/shared';
import { resamplePeaks } from './peaks';

/** Bar metrics from spec/design.md "Waveform", in CSS pixels. */
export const BAR_WIDTH = 3;
export const BAR_GAP = 2;
export const BAR_PITCH = BAR_WIDTH + BAR_GAP;
export const BAR_MIN_HEIGHT = 2;

/**
 * Horizontal layout of a bar strip. Bars are centred in the width so the leftover (< one pitch)
 * splits evenly; `contentWidth` runs from the left edge of the first bar to the right edge of the last.
 */
export interface BarLayout {
  count: number;
  x0: number;
  contentWidth: number;
}

export function layoutBars(width: number): BarLayout {
  const count = Math.max(0, Math.floor((width + BAR_GAP) / BAR_PITCH));
  const contentWidth = count > 0 ? count * BAR_PITCH - BAR_GAP : 0;
  // Snap to whole pixels so bar edges land on the pixel grid.
  const x0 = Math.floor((width - contentWidth) / 2);
  return { count, x0, contentWidth };
}

export function barX(layout: BarLayout, index: number): number {
  return layout.x0 + index * BAR_PITCH;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Seconds -> x, clamped to the bar strip. */
export function timeToX(layout: BarLayout, timeSec: number, durationSec: number): number {
  if (durationSec <= 0) return layout.x0;
  return layout.x0 + clamp(timeSec / durationSec, 0, 1) * layout.contentWidth;
}

/** x -> seconds, clamped to [0, duration]. The inverse of timeToX inside the strip. */
export function xToTime(layout: BarLayout, x: number, durationSec: number): number {
  if (layout.contentWidth <= 0 || durationSec <= 0) return 0;
  return clamp((x - layout.x0) / layout.contentWidth, 0, 1) * durationSec;
}

/**
 * Indices of the bars a time span covers. A span narrower than a bar (a short "um") still
 * returns the single bar nearest its centre, so every filler is visible.
 */
export function barsForSpan(layout: BarLayout, startSec: number, endSec: number, durationSec: number): number[] {
  if (layout.count === 0) return [];
  const left = timeToX(layout, Math.min(startSec, endSec), durationSec);
  const right = timeToX(layout, Math.max(startSec, endSec), durationSec);
  const out: number[] = [];
  for (let i = 0; i < layout.count; i += 1) {
    const x = barX(layout, i);
    if (x + BAR_WIDTH > left && x < right) out.push(i);
  }
  if (out.length > 0) return out;
  const centre = (left + right) / 2;
  const nearest = Math.round((centre - layout.x0 - BAR_WIDTH / 2) / BAR_PITCH);
  return [clamp(nearest, 0, layout.count - 1)];
}

/** Bar height for a 0..1 level: a gentle curve so quiet speech still reads, never below the minimum. */
export function barHeight(level: number, maxHeight: number): number {
  const shaped = Math.pow(clamp(level, 0, 1), 0.75);
  return Math.max(BAR_MIN_HEIGHT, Math.round(shaped * maxHeight));
}

const LIVE_FLOOR_DB = -60;
const LIVE_CEIL_DB = -12;

/** Live analyser RMS -> 0..1 on a decibel scale, so normal speaking levels fill the strip. */
export function amplitudeToLevel(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return clamp((db - LIVE_FLOOR_DB) / (LIVE_CEIL_DB - LIVE_FLOOR_DB), 0, 1);
}

/** "0:07", "1:32", "12:04". */
export function formatClock(sec: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export type WaveformMarkKind = 'filler' | 'pause';

/** A selectable marker on the playback waveform. */
export interface WaveformMark {
  id: string;
  kind: WaveformMarkKind;
  turnIndex: number;
  start: number;
  end: number;
  /** Accessible name, e.g. "Filler: um at 0:12". */
  label: string;
  /** For fillers, the word index to highlight in the transcript; for pauses, the word before the gap. */
  wordIndex: number;
}

export function fillerMarkId(mark: Pick<FillerMark, 'turnIndex' | 'wordIndex'>): string {
  return `filler-${mark.turnIndex}-${mark.wordIndex}`;
}

export function pauseMarkId(mark: Pick<PauseMark, 'turnIndex' | 'afterWordIndex'>): string {
  return `pause-${mark.turnIndex}-${mark.afterWordIndex}`;
}

/** Filler and pause marks as one time-ordered list of selectable markers. */
export function buildWaveformMarks(fillers: readonly FillerMark[], pauses: readonly PauseMark[]): WaveformMark[] {
  const fromFillers = fillers.map<WaveformMark>((m) => ({
    id: fillerMarkId(m),
    kind: 'filler',
    turnIndex: m.turnIndex,
    start: m.start,
    end: m.end,
    label: `Filler: ${m.word} at ${formatClock(m.start)}`,
    wordIndex: m.wordIndex,
  }));
  const fromPauses = pauses.map<WaveformMark>((m) => ({
    id: pauseMarkId(m),
    kind: 'pause',
    turnIndex: m.turnIndex,
    start: m.start,
    end: m.end,
    label: `Pause: ${m.durationSec.toFixed(1)} seconds at ${formatClock(m.start)}`,
    wordIndex: m.afterWordIndex,
  }));
  return [...fromFillers, ...fromPauses].sort((a, b) => a.start - b.start);
}

/** Keep only the marks and drift ranges of one turn, for a per-turn waveform. */
export function marksForTurn<T extends { turnIndex: number }>(items: readonly T[], turnIndex: number): T[] {
  return items.filter((item) => item.turnIndex === turnIndex);
}

export function describeDrift(range: PaceDriftRange): string {
  return `Pace ${range.direction === 'fast' ? 'too fast' : 'too slow'} from ${formatClock(range.start)} to ${formatClock(range.end)}`;
}

/** resamplePeaks with non-finite values coerced to 0, so bad data draws silence instead of NaN. */
export function resamplePeaksSafe(peaks: readonly number[], count: number): number[] {
  return resamplePeaks(peaks, count).map((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));
}
