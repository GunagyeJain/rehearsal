import { useId } from 'react';
import { cx } from './cx';
import styles from './SegmentedControl.module.css';

interface SegmentedControlProps<T extends string> {
  legend: string;
  hideLegend?: boolean;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A compact single choice between two to four short options, such as theme or font. */
export function SegmentedControl<T extends string>({
  legend,
  hideLegend = false,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={styles.fieldset}>
      <legend className={hideLegend ? 'visually-hidden' : styles.legend}>{legend}</legend>
      <div className={styles.track}>
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label key={option.value} className={cx(styles.segment, checked && styles.checked)}>
              <input
                type="radio"
                className={styles.input}
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
