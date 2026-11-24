import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AttemptHistoryGroup } from '@rehearsal/shared';
import { describeTrend, linePath, seriesForGroup, sparklineGeometry, type TrendSeries } from './trend';
import { TrendSparkline } from './TrendSparkline';

const BOX = { width: 120, height: 36, inset: 4 };

function attempt(id: string, passedCount: number, wpm: number, fillers: number) {
  return {
    id,
    startedAt: '2026-11-01T10:00:00.000Z',
    completedAt: '2026-11-01T10:01:00.000Z',
    passed: passedCount === 3,
    passedCount,
    totalCount: 3,
    judgeUnavailable: false,
    metrics: { wpm, fillersPerMinute: fillers, longestPauseSec: 2, durationSec: 40 },
  };
}

const group: AttemptHistoryGroup = {
  scenario: { id: 'self-introduction', title: 'Self-introduction', track: 'fundamentals' },
  // Newest first.
  attempts: [attempt('d', 3, 150, 2.4), attempt('c', 2, 160, 3), attempt('b', 1, 175, 4.5), attempt('a', 1, 190, 6.1)],
  trend: {
    wpm: [190, 175, 160, 150],
    fillersPerMinute: [6.1, 4.5, 3, 2.4],
    longestPauseSec: [3.2, 2.5, 2, 2],
    durationSec: [40, 40, 40, 40],
  },
  targets: { wpm: { op: 'between', value: [120, 170] }, fillersPerMinute: { op: 'lte', value: 3 } },
};

describe('trend model', () => {
  it('describes a series as first to last over the attempt count', () => {
    const series = seriesForGroup(group).find((s) => s.id === 'fillersPerMinute');
    expect(series && describeTrend(series)).toBe('Fillers per minute: 6.1 to 2.4 over 4 attempts');
  });

  it('describes a single attempt and an empty series', () => {
    const format = (n: number) => `${n}`;
    expect(describeTrend({ label: 'Pace', values: [140], format })).toBe('Pace: 140 from 1 attempt');
    expect(describeTrend({ label: 'Pace', values: [], format })).toBe('Pace: no attempts yet');
  });

  it('derives criteria met oldest to newest from attempts, and flags the latest against targets', () => {
    const series = seriesForGroup(group);
    const criteria = series.find((s) => s.id === 'criteria');
    expect(criteria?.values).toEqual([1, 1, 2, 3]);
    expect(criteria && describeTrend(criteria)).toBe('Criteria met: 1 of 3 to 3 of 3 over 4 attempts');
    expect(criteria?.latestMeetsTarget).toBe(true);
    expect(series.find((s) => s.id === 'wpm')?.latestMeetsTarget).toBe(true);
    expect(series.find((s) => s.id === 'longestPauseSec')?.target).toBeNull();
  });

  it('maps values left to right with higher values drawn higher, inside the inset', () => {
    const { points, band } = sparklineGeometry([1, 3, 2], BOX, null);
    expect(points.map((p) => p.x)).toEqual([4, 60, 116]);
    expect(points[1]?.y).toBeCloseTo(4);
    expect(points[0]?.y).toBeCloseTo(32);
    expect(band).toBeNull();
  });

  it('keeps the target band in view and centres a flat or single series', () => {
    const { band } = sparklineGeometry([190, 180], BOX, { low: 120, high: 170 });
    expect(band).not.toBeNull();
    expect((band?.y ?? 0) + (band?.height ?? 0)).toBeLessThanOrEqual(BOX.height - BOX.inset + 0.001);
    const single = sparklineGeometry([5], BOX, null);
    expect(single.points).toEqual([{ x: 60, y: 18 }]);
    expect(linePath([{ x: 0, y: 1 }, { x: 2, y: 3 }])).toBe('M0.00 1.00 L2.00 3.00');
  });
});

describe('TrendSparkline', () => {
  const series: TrendSeries | undefined = seriesForGroup(group).find((s) => s.id === 'fillersPerMinute');

  it('exposes the full text equivalent as the chart name and shows the change as text', () => {
    if (!series) throw new Error('missing series');
    render(<TrendSparkline series={series} />);
    expect(
      screen.getByRole('img', { name: 'Fillers per minute: 6.1 to 2.4 over 4 attempts' }),
    ).toBeTruthy();
    expect(screen.getByText('6.1 to 2.4 over 4 attempts')).toBeTruthy();
    expect(screen.getByText('Fillers per minute')).toBeTruthy();
  });

  it('marks the latest value as within target with a labelled icon, never colour alone', () => {
    if (!series) throw new Error('missing series');
    render(<TrendSparkline series={series} />);
    expect(screen.getByRole('img', { name: 'within target' })).toBeTruthy();
  });

  it('draws a line through every attempt and a target band', () => {
    if (!series) throw new Error('missing series');
    render(<TrendSparkline series={series} />);
    const chart = screen.getByRole('img', { name: /^Fillers per minute:/ });
    expect(chart.querySelector('path')?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(4);
    expect(chart.querySelector('rect')).not.toBeNull();
    expect(chart.querySelectorAll('circle')).toHaveLength(4);
  });
});
