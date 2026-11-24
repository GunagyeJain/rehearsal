import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';
import styles from './Field.module.css';

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Shown after the label in muted text, e.g. "Optional". */
  labelAside?: string;
  children: ReactNode;
}

function fieldDescribedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** Label, control, hint and error laid out consistently. */
export function Field({ id, label, hint, error, labelAside, children }: FieldProps) {
  return (
    <div className={cx(styles.field, error && styles.hasError)}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {labelAside && <span className={styles.labelAside}>{labelAside}</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          <Icon icon={AlertCircle} size="sm" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

interface CommonControlProps {
  label: string;
  hint?: string;
  error?: string;
  labelAside?: string;
}

type TextInputProps = CommonControlProps &
  InputHTMLAttributes<HTMLInputElement> & {
    /** A control inside the field's right edge, e.g. a show-password IconButton. */
    trailing?: ReactNode;
  };

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, labelAside, id, className, trailing, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = (
    <input
      ref={ref}
      id={inputId}
      className={cx(styles.control, trailing !== undefined && styles.withTrailing, className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={fieldDescribedBy(inputId, hint, error)}
      {...rest}
    />
  );
  return (
    <Field id={inputId} label={label} hint={hint} error={error} labelAside={labelAside}>
      {trailing === undefined ? (
        input
      ) : (
        <div className={styles.trailingWrap}>
          {input}
          <span className={styles.trailing}>{trailing}</span>
        </div>
      )}
    </Field>
  );
});

type TextareaProps = CommonControlProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, labelAside, id, className, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} labelAside={labelAside}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className={cx(styles.control, styles.textarea, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(inputId, hint, error)}
        {...rest}
      />
    </Field>
  );
});

export interface SelectOption {
  value: string;
  label: string;
}

type SelectProps = CommonControlProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: readonly SelectOption[];
    /** Disabled first option shown when no value is chosen. */
    placeholder?: string;
  };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, labelAside, id, className, options, placeholder, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} labelAside={labelAside}>
      <div className={styles.selectWrap}>
        <select
          ref={ref}
          id={inputId}
          className={cx(styles.control, styles.select, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(inputId, hint, error)}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={styles.chevron}>
          <Icon icon={ChevronDown} />
        </span>
      </div>
    </Field>
  );
});
