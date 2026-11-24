import { DIFFICULTY_LEVELS } from './exploreModel';
import styles from './DifficultyMeter.module.css';

interface DifficultyMeterProps {
  level: number;
  label: string;
}

const STEP_CLASS: Readonly<Record<number, string | undefined>> = {
  1: styles.step1,
  2: styles.step2,
  3: styles.step3,
  4: styles.step4,
  5: styles.step5,
};

/** Five rising steps, filled up to the level, always paired with its word. */
export function DifficultyMeter({ level, label }: DifficultyMeterProps) {
  return (
    <p className={styles.meter}>
      <span className={styles.steps} aria-hidden="true">
        {DIFFICULTY_LEVELS.map((step) => (
          <span key={step} className={`${styles.step} ${STEP_CLASS[step] ?? ''} ${step <= level ? styles.filled : ''}`} />
        ))}
      </span>
      <span className="visually-hidden">{`Difficulty ${level} of ${DIFFICULTY_LEVELS.length}: `}</span>
      <span className={styles.label}>{label}</span>
    </p>
  );
}
