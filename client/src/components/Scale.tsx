import { useId } from 'react';
import { cx } from './cx';
import styles from './Scale.module.css';

interface ScaleProps {
  legend: string;
  hideLegend?: boolean;
  /** Label under the lowest value. Only the two ends are labelled. */
  lowLabel: string;
  highLabel: string;
  min?: number;
  max?: number;
  value: number | null;
  onChange: (value: number) => void;
}

/** A 1 to 5 (by default) rating, labelled at both ends only. */
export function Scale({ legend, hideLegend = false, lowLabel, highLabel, min = 1, max = 5, value, onChange }: ScaleProps) {
  const name = useId();
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <fieldset className={styles.fieldset}>
      <legend className={hideLegend ? 'visually-hidden' : styles.legend}>{legend}</legend>
      <div className={styles.row}>
        {values.map((n) => {
          const checked = n === value;
          const endLabel = n === min ? lowLabel : n === max ? highLabel : null;
          return (
            <label key={n} className={cx(styles.step, checked && styles.checked)}>
              <input
                type="radio"
                className={styles.input}
                name={name}
                value={n}
                checked={checked}
                onChange={() => onChange(n)}
                aria-label={endLabel ? `${n}, ${endLabel}` : String(n)}
              />
              <span className={styles.number} aria-hidden="true">
                {n}
              </span>
            </label>
          );
        })}
      </div>
      <div className={styles.ends} aria-hidden="true">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </fieldset>
  );
}
