import { describe, expect, it } from 'vitest';
import type { FillerMark, PauseMark } from '@rehearsal/shared';
import {
  amplitudeToLevel,
  BAR_MIN_HEIGHT,
  BAR_PITCH,
  BAR_WIDTH,
  barHeight,
  barsForSpan,
  barX,
  buildWaveformMarks,
  formatClock,
  layoutBars,
  marksForTurn,
  timeToX,
  xToTime,
} from './geometry';

describe('layoutBars', () => {
  it('fits 3px bars with 2px gaps and centres the leftover', () => {
    const layout = layoutBars(100);
    expect(layout.count).toBe(20);
    expect(layout.contentWidth).toBe(98);
    expect(layout.x0).toBe(1);
    expect(barX(layout, 1) - barX(layout, 0)).toBe(BAR_PITCH);
  });

  it('is empty for no width', () => {
    expect(layoutBars(0).count).toBe(0);
  });
});

describe('timeToX and xToTime', () => {
  const layout = layoutBars(500);

  it('maps the ends of the recording to the ends of the strip', () => {
    expect(timeToX(layout, 0, 60)).toBe(layout.x0);
    expect(timeToX(layout, 60, 60)).toBe(layout.x0 + layout.contentWidth);
  });

  it('round-trips', () => {
    expect(xToTime(layout, timeToX(layout, 12.5, 60), 60)).toBeCloseTo(12.5);
  });

  it('clamps outside the strip and the duration', () => {
    expect(xToTime(layout, -50, 60)).toBe(0);
    expect(xToTime(layout, 9999, 60)).toBe(60);
    expect(timeToX(layout, 120, 60)).toBe(layout.x0 + layout.contentWidth);
  });

  it('survives a zero duration', () => {
    expect(timeToX(layout, 5, 0)).toBe(layout.x0);
    expect(xToTime(layout, 100, 0)).toBe(0);
  });
});

describe('barsForSpan', () => {
  const layout = layoutBars(500);

  it('covers every bar a span overlaps', () => {
    const bars = barsForSpan(layout, 0, 6, 60);
    expect(bars[0]).toBe(0);
    expect(bars.length).toBeGreaterThanOrEqual(9);
    expect(bars.length).toBeLessThanOrEqual(11);
  });

  it('gives a very short filler exactly one bar, the nearest', () => {
    const bars = barsForSpan(layout, 30, 30.01, 60);
    expect(bars).toHaveLength(1);
    const centre = timeToX(layout, 30.005, 60);
    expect(Math.abs(barX(layout, bars[0] ?? -1) + BAR_WIDTH / 2 - centre)).toBeLessThanOrEqual(BAR_PITCH);
  });

  it('is empty when there are no bars', () => {
    expect(barsForSpan(layoutBars(0), 1, 2, 10)).toEqual([]);
  });
});

describe('barHeight and amplitudeToLevel', () => {
  it('never draws below the minimum height', () => {
    expect(barHeight(0, 60)).toBe(BAR_MIN_HEIGHT);
    expect(barHeight(1, 60)).toBe(60);
  });

  it('maps speaking levels on a dB scale', () => {
    expect(amplitudeToLevel(0)).toBe(0);
    expect(amplitudeToLevel(0.001)).toBe(0);
    expect(amplitudeToLevel(0.5)).toBe(1);
    const mid = amplitudeToLevel(0.02);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.9);
  });
});

describe('formatClock', () => {
  it('formats minutes and padded seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(12.9)).toBe('0:12');
    expect(formatClock(92)).toBe('1:32');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('buildWaveformMarks', () => {
  const fillers: FillerMark[] = [
    { word: 'um', start: 12.2, end: 12.5, turnIndex: 0, wordIndex: 30, wordCount: 1 },
    { word: 'you know', start: 3, end: 3.6, turnIndex: 1, wordIndex: 8, wordCount: 2 },
  ];
  const pauses: PauseMark[] = [{ start: 5, end: 8.4, durationSec: 3.4, turnIndex: 0, afterWordIndex: 12 }];

  it('labels marks for screen readers and orders them by time', () => {
    const marks = buildWaveformMarks(marksForTurn(fillers, 0), marksForTurn(pauses, 0));
    expect(marks.map((m) => m.label)).toEqual(['Pause: 3.4 seconds at 0:05', 'Filler: um at 0:12']);
    expect(marks.map((m) => m.id)).toEqual(['pause-0-12', 'filler-0-30']);
  });

  it('filters by turn', () => {
    expect(marksForTurn(fillers, 1)).toHaveLength(1);
  });
});
