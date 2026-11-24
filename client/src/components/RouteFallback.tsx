import { Spinner } from './Spinner';
import styles from './RouteFallback.module.css';

/** Quiet Suspense fallback for lazily loaded screens. */
export function RouteFallback() {
  return (
    <div className={styles.fallback}>
      <Spinner label="Loading" className={styles.spinner} />
    </div>
  );
}
