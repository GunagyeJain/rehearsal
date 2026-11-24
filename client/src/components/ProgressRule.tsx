import type { CSSProperties } from 'react';
import { cx } from './cx';
import styles from './ProgressRule.module.css';

interface ProgressRuleProps {
  /** Completed steps. */
  value: number;
  total: number;
  /** Accessible name, e.g. "Onboarding progress". */
  label: string;
  /** Pins the rule to the very top of the viewport. */
  fixed?: boolean;
}

/** A thin line across the top showing progress through a sequence. */
export function ProgressRule({ value, total, label, fixed = false }: ProgressRuleProps) {
  const clamped = Math.min(Math.max(value, 0), total);
  const fraction = total > 0 ? clamped / total : 0;
  const style = { '--progress': fraction } as CSSProperties;

  return (
    <div
      className={cx(styles.rule, fixed && styles.fixed)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped} of ${total}`}
      style={style}
    >
      <span className={styles.fill} />
    </div>
  );
}
