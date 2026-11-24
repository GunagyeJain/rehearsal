import { Check } from 'lucide-react';
import { Icon } from '../../components';
import { describeChange, describeTrend, linePath, sparklineGeometry, type SparklineBox, type TrendSeries } from './trend';
import styles from './TrendSparkline.module.css';

/** SVG user units; the drawing scales with its container while keeping its proportions. */
const BOX: SparklineBox = { width: 120, height: 36, inset: 4 };
const DOT_RADIUS = 2.5;

interface TrendSparklineProps {
  series: TrendSeries;
}

/**
 * One measure across attempts: a quiet line, the rubric target as a sunken band, the newest value
 * as a dot. The text equivalent is real text, so screen readers and the sighted read the same thing.
 */
export function TrendSparkline({ series }: TrendSparklineProps) {
  const { points, band } = sparklineGeometry(series.values, BOX, series.target);
  const latest = series.values[series.values.length - 1];
  const last = points[points.length - 1];

  return (
    <figure className={styles.trend}>
      <figcaption className={styles.caption}>
        <span className={styles.label}>{series.label}</span>
        {latest !== undefined && (
          <span className={styles.value}>
            {series.format(latest)}
            {series.latestMeetsTarget && (
              <span className={styles.met}>
                <Icon icon={Check} size="sm" label="within target" />
              </span>
            )}
          </span>
        )}
      </figcaption>
      <svg className={styles.chart} viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={describeTrend(series)} focusable="false">
        {band && <rect className={styles.band} x={0} y={band.y} width={BOX.width} height={band.height} rx={2} />}
        {points.length > 1 && <path className={styles.line} d={linePath(points)} />}
        {points.slice(0, -1).map((p, i) => (
          <circle key={i} className={styles.point} cx={p.x} cy={p.y} r={DOT_RADIUS - 1} />
        ))}
        {last && <circle className={styles.latest} cx={last.x} cy={last.y} r={DOT_RADIUS} />}
      </svg>
      <p className={styles.description} aria-hidden="true">
        {describeChange(series)}
      </p>
    </figure>
  );
}
