import { cx } from './cx';
import styles from './Spinner.module.css';

interface SpinnerProps {
  /** Announced to screen readers. */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ label = 'Loading', size = 'md', className }: SpinnerProps) {
  return (
    <span role="status" className={cx(styles.spinner, styles[size], className)}>
      <svg viewBox="0 0 24 24" className={styles.svg} aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="12" cy="12" r="9.5" fill="none" />
        <circle className={styles.arc} cx="12" cy="12" r="9.5" fill="none" pathLength="100" />
      </svg>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

interface LoadingStateProps {
  /** Short, plain line: "Loading your path". */
  message: string;
}

/** Full-region loading state with a single line of copy. */
export function LoadingState({ message }: LoadingStateProps) {
  return (
    <div className={styles.state}>
      <Spinner label={message} />
      <p className={styles.message} aria-hidden="true">
        {message}
      </p>
    </div>
  );
}
