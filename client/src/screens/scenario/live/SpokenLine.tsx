import { useEffect, useMemo, useState } from 'react';
import styles from './LiveScreen.module.css';

interface SpokenLineProps {
  text: string;
  /** While true, words appear in step with the audio over durationSec. */
  revealing: boolean;
  durationSec: number;
}

const REVEAL_TICK_MS = 50;

/**
 * The AI's current line, revealed word by word as it is spoken. Screen readers get the whole
 * line at once; the reveal is visual only. Key this component by turn so each line starts fresh.
 */
export function SpokenLine({ text, revealing, durationSec }: SpokenLineProps) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [shown, setShown] = useState(revealing ? 0 : words.length);

  useEffect(() => {
    if (!revealing) return;
    const startedAt = performance.now();
    const totalMs = Math.max(durationSec, 0.1) * 1000;
    const timer = window.setInterval(() => {
      const fraction = Math.min(1, (performance.now() - startedAt) / totalMs);
      setShown(Math.max(1, Math.ceil(fraction * words.length)));
      if (fraction >= 1) window.clearInterval(timer);
    }, REVEAL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [revealing, durationSec, words.length]);

  const visible = revealing ? shown : words.length;

  return (
    <p className={styles.line}>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true">
        {words.map((word, i) => (
          <span key={`${i}-${word}`} className={i < visible ? styles.wordShown : styles.wordHidden}>
            {word}{' '}
          </span>
        ))}
      </span>
    </p>
  );
}
