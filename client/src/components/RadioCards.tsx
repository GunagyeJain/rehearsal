import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Check } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';
import styles from './RadioCards.module.css';

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: LucideIcon;
}

interface RadioCardsProps<T extends string> {
  legend: string;
  /** Hide the legend visually when the screen title already asks the question. */
  hideLegend?: boolean;
  name?: string;
  options: readonly RadioCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  /** Rendered after the options, e.g. a "Something else" text field. */
  footer?: ReactNode;
}

/** A single-choice list of large, tappable options. Native radios, so arrow keys work. */
export function RadioCards<T extends string>({
  legend,
  hideLegend = false,
  name,
  options,
  value,
  onChange,
  error,
  footer,
}: RadioCardsProps<T>) {
  const autoName = useId();
  const groupName = name ?? autoName;
  const errorId = `${groupName}-error`;

  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? errorId : undefined}>
      <legend className={hideLegend ? 'visually-hidden' : styles.legend}>{legend}</legend>
      <div className={styles.list}>
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label key={option.value} className={cx(styles.option, checked && styles.checked)}>
              <input
                type="radio"
                className={styles.input}
                name={groupName}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              {option.icon && (
                <span className={styles.leading}>
                  <Icon icon={option.icon} />
                </span>
              )}
              <span className={styles.text}>
                <span className={styles.label}>{option.label}</span>
                {option.description && <span className={styles.description}>{option.description}</span>}
              </span>
              <span className={styles.mark} aria-hidden="true">
                <Icon icon={Check} size="sm" />
              </span>
            </label>
          );
        })}
      </div>
      {footer}
      {error && (
        <p id={errorId} className={styles.error}>
          <Icon icon={AlertCircle} size="sm" />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
}
