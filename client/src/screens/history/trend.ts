import { formatMetricValue, type AttemptHistoryGroup, type TrendMetric } from '@rehearsal/shared';

/** Pure helpers behind the History trend sparklines. */

export interface TrendBand {
  low: number;
  high: number;
}

export interface TrendSeries {
  id: string;
  label: string;
  /** Oldest to newest. */
  values: number[];
  format: (value: number) => string;
  /** The rubric's target range, drawn as a band; null when the scenario does not target this measure. */
  target: TrendBand | null;
  /** Whether the newest value sits inside the target. */
  latestMeetsTarget: boolean | null;
}

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  points: SparklinePoint[];
  /** Target band in the same coordinate space, or null. */
  band: { y: number; height: number } | null;
}

export interface SparklineBox {
  width: number;
  height: number;
  /** Inset so end dots are never clipped. */
  inset: number;
}

const METRIC_LABELS: Readonly<Record<Exclude<TrendMetric, 'durationSec'>, string>> = {
  wpm: 'Pace',
  fillersPerMinute: 'Fillers per minute',
  longestPauseSec: 'Longest pause',
};

/** The measures History trends, in display order. */
export const HISTORY_TREND_METRICS = ['wpm', 'fillersPerMinute', 'longestPauseSec'] as const;

/** Upper bound used for an open-ended target ("at least N") so the band stays on the chart. */
function bandFromTarget(target: AttemptHistoryGroup['targets'][TrendMetric], values: readonly number[]): TrendBand | null {
  if (!target) return null;
  const max = Math.max(...values, 0);
  if (target.op === 'between' && Array.isArray(target.value)) return { low: target.value[0], high: target.value[1] };
  if (typeof target.value !== 'number') return null;
  if (target.op === 'lte') return { low: 0, high: target.value };
  return { low: target.value, high: Math.max(max, target.value) };
}

function inBand(value: number | undefined, band: TrendBand | null): boolean | null {
  if (value === undefined || !band) return null;
  return value >= band.low && value <= band.high;
}

/** Build the series shown for one scenario group: three rubric measures and criteria met. */
export function seriesForGroup(group: AttemptHistoryGroup): TrendSeries[] {
  const metricSeries = HISTORY_TREND_METRICS.map((metric): TrendSeries => {
    const values = group.trend[metric];
    const target = bandFromTarget(group.targets[metric], values);
    return {
      id: metric,
      label: METRIC_LABELS[metric],
      values,
      // The label already says "per minute", so fillers read as a bare number ("6.1 to 2.4").
      format: (value) => (metric === 'fillersPerMinute' ? value.toFixed(1) : formatMetricValue(metric, value)),
      target,
      latestMeetsTarget: inBand(values[values.length - 1], target),
    };
  });
  const oldestFirst = [...group.attempts].reverse();
  const total = Math.max(...oldestFirst.map((a) => a.totalCount), 0);
  const criteria: TrendSeries = {
    id: 'criteria',
    label: 'Criteria met',
    values: oldestFirst.map((a) => a.passedCount),
    format: (value) => `${Math.round(value)} of ${total}`,
    target: total > 0 ? { low: total, high: total } : null,
    latestMeetsTarget: oldestFirst.length > 0 ? oldestFirst[oldestFirst.length - 1]?.passedCount === total : null,
  };
  return [...metricSeries, criteria];
}

function plural(count: number): string {
  return count === 1 ? '1 attempt' : `${count} attempts`;
}

/** The change alone: "6.1 to 2.4 over 4 attempts". */
export function describeChange(series: Pick<TrendSeries, 'values' | 'format'>): string {
  const { values, format } = series;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return 'no attempts yet';
  if (values.length === 1) return `${format(first)} from 1 attempt`;
  return `${format(first)} to ${format(last)} over ${plural(values.length)}`;
}

/** Text equivalent of a sparkline: "Fillers per minute: 6.1 to 2.4 over 4 attempts". */
export function describeTrend(series: Pick<TrendSeries, 'label' | 'values' | 'format'>): string {
  return `${series.label}: ${describeChange(series)}`;
}

/**
 * Map values (oldest to newest) into a box. The y domain includes the target band so it is always
 * visible; a flat series sits in the middle. Higher values are drawn higher.
 */
export function sparklineGeometry(values: readonly number[], box: SparklineBox, target: TrendBand | null): SparklineGeometry {
  const { width, height, inset } = box;
  const domainValues = target ? [...values, target.low, target.high] : [...values];
  if (domainValues.length === 0) return { points: [], band: null };
  let min = Math.min(...domainValues);
  let max = Math.max(...domainValues);
  if (max === min) {
    const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const yOf = (value: number) => inset + innerH - ((value - min) / (max - min)) * innerH;
  const points = values.map((value, i) => ({
    x: values.length === 1 ? width / 2 : inset + (i / (values.length - 1)) * innerW,
    y: yOf(value),
  }));
  const band = target ? { y: yOf(target.high), height: Math.max(yOf(target.low) - yOf(target.high), 1) } : null;
  return { points, band };
}

/** SVG path data through the points. */
export function linePath(points: readonly SparklinePoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}
