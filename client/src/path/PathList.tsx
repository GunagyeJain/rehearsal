import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Lock, RotateCcw, SkipForward } from 'lucide-react';
import { TRACK_LABELS, type PathItem } from '@rehearsal/shared';
import { cx, Icon } from '../components';
import { scenarioHref } from './scenarioHref';
import styles from './PathList.module.css';

export type PathListVariant = 'home' | 'reveal';

interface PathListProps {
  items: readonly PathItem[];
  /** 'home' gives rows their state and the single action; 'reveal' is the read-only onboarding list. */
  variant: PathListVariant;
  /** Accessible name for the list. */
  label: string;
}

interface RowCopy {
  status: string;
  action: string | null;
}

/**
 * Visible state words: "Not yet", never "failed" (spec/product.md). Repeating a scenario is "Retry"
 * everywhere (path rows, report actions), matching spec/screens.md.
 */
function rowCopy(item: PathItem): RowCopy {
  switch (item.state) {
    case 'passed':
      return { status: 'Passed', action: null };
    case 'skipped':
      return { status: 'Skipped', action: 'Retry' };
    case 'failed':
      return { status: 'Not yet', action: 'Retry' };
    case 'available':
      return { status: 'Up next', action: 'Begin' };
    default:
      return { status: 'Locked', action: null };
  }
}

function StateMark({ item }: { item: PathItem }) {
  if (item.state === 'passed') return <Icon icon={Check} size="sm" className={styles.markPassed} />;
  if (item.state === 'skipped') return <Icon icon={SkipForward} size="sm" />;
  if (item.state === 'locked') return <Icon icon={Lock} size="sm" />;
  if (item.state === 'failed') return <Icon icon={RotateCcw} size="sm" />;
  return null;
}

function HomeRow({ item }: { item: PathItem }) {
  const copy = rowCopy(item);
  const actionable = item.state === 'available' || item.state === 'failed';
  const tappable = actionable || item.state === 'skipped';
  const label = `${item.title}, ${TRACK_LABELS[item.track]}, ${copy.status}`;
  return (
    <div
      className={cx(
        styles.row,
        styles[item.state],
        item.isCurrent && styles.current,
        tappable && styles.tappable,
      )}
    >
      <span className={styles.index} aria-hidden="true">
        {item.position + 1}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.meta}>
          <span>{TRACK_LABELS[item.track]}</span>
          {item.state !== 'available' && (
            <span className={styles.status}>
              {/* Skipped and not-yet rows keep their distinct icon next to the word, since their end slot holds Retry. */}
              {tappable ? (
                <span className={styles.statusMark} aria-hidden="true">
                  <StateMark item={item} />
                </span>
              ) : (
                <span className={styles.dot} aria-hidden="true" />
              )}
              {copy.status}
            </span>
          )}
        </span>
      </span>
      <span className={styles.end}>
        {tappable && copy.action ? (
          <Link
            to={scenarioHref(item.scenarioId)}
            className={cx(styles.action, item.isCurrent && styles.actionPrimary)}
            aria-label={`${copy.action}: ${label}`}
          >
            <span>{copy.action}</span>
            {item.isCurrent && <Icon icon={ArrowRight} size="sm" />}
          </Link>
        ) : (
          <span className={styles.mark} aria-hidden="true">
            <StateMark item={item} />
          </span>
        )}
      </span>
    </div>
  );
}

function RevealRow({ item }: { item: PathItem }) {
  const first = item.position === 0;
  return (
    <div className={cx(styles.row, first ? styles.current : styles.upcoming)}>
      <span className={styles.index} aria-hidden="true">
        {item.position + 1}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.meta}>
          <span>{TRACK_LABELS[item.track]}</span>
        </span>
      </span>
      {first && <span className={styles.badge}>Start here</span>}
    </div>
  );
}

/** The path as a vertical list (spec/screens.md sections 2 and 3). State is derived server-side. */
export function PathList({ items, variant, label }: PathListProps) {
  return (
    <ol className={cx(styles.list, variant === 'reveal' && styles.reveal)} aria-label={label}>
      {items.map((item) => (
        <li key={item.scenarioId} className={styles.item} style={{ '--row-index': item.position } as CSSProperties}>
          {variant === 'home' ? <HomeRow item={item} /> : <RevealRow item={item} />}
        </li>
      ))}
    </ol>
  );
}
