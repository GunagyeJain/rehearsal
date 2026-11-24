import { useEffect, useMemo, useRef } from 'react';
import { cx } from '../../../components';
import type { TurnView } from './reportModel';
import styles from './Report.module.css';

export interface WordRef {
  turnIndex: number;
  wordIndex: number;
  /** Words covered, for multi-word fillers such as "you know". */
  wordCount: number;
}

interface TranscriptProps {
  turns: readonly TurnView[];
  highlighted: WordRef | null;
}

function fillerIndexes(turn: TurnView): Set<number> {
  const out = new Set<number>();
  for (const mark of turn.fillerMarks) {
    for (let i = 0; i < mark.wordCount; i += 1) out.add(mark.wordIndex + i);
  }
  return out;
}

/** The full conversation with filler words underlined and the selected word highlighted. */
export function Transcript({ turns, highlighted }: TranscriptProps) {
  const highlightRef = useRef<HTMLElement | null>(null);
  const fillers = useMemo(() => turns.map(fillerIndexes), [turns]);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);

  return (
    <ol className={styles.transcript}>
      {turns.map((turn, t) => (
        <li key={turn.index} className={styles.transcriptTurn}>
          <p className={cx(styles.transcriptLine, styles.transcriptAi)}>
            <span className={styles.transcriptSpeaker}>AI</span>
            {turn.aiText}
          </p>
          <p className={cx(styles.transcriptLine, styles.transcriptUser)}>
            <span className={styles.transcriptSpeaker}>You</span>
            {turn.words.map((w, i) => {
              const isHighlighted =
                highlighted?.turnIndex === turn.index && i >= highlighted.wordIndex && i < highlighted.wordIndex + highlighted.wordCount;
              const isFirstHighlighted = isHighlighted && i === highlighted?.wordIndex;
              const isFiller = fillers[t]?.has(i) ?? false;
              // The wavy underline is visual only; screen readers hear the filler label instead.
              const text = (
                <>
                  {w.word.trim()}
                  {isFiller && <span className="visually-hidden"> (filler)</span>}{' '}
                </>
              );
              if (isHighlighted) {
                return (
                  <mark key={i} ref={isFirstHighlighted ? highlightRef : undefined} className={cx(styles.word, styles.highlight, isFiller && styles.filler)}>
                    {text}
                  </mark>
                );
              }
              return (
                <span key={i} className={cx(styles.word, isFiller && styles.filler)}>
                  {text}
                </span>
              );
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}
