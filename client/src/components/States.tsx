import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, RotateCcw, X } from 'lucide-react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import styles from './States.module.css';

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Invites an action: "Your first attempt will appear here." */
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.state}>
      {icon && (
        <span className={styles.glyph}>
          <Icon icon={icon} size="lg" />
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {body && <div className={styles.body}>{body}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  /** What happened, plainly. */
  title: string;
  /** What to do about it. */
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
}

export function ErrorState({ title, message, onRetry, retryLabel = 'Retry', retrying = false }: ErrorStateProps) {
  return (
    <div className={styles.state} role="alert">
      <span className={cx(styles.glyph, styles.glyphFail)}>
        <Icon icon={AlertCircle} size="lg" />
      </span>
      <p className={styles.title}>{title}</p>
      {message && <div className={styles.body}>{message}</div>}
      {onRetry && (
        <div className={styles.action}>
          <Button variant="secondary" icon={RotateCcw} onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export type NoticeTone = 'info' | 'warn' | 'fail' | 'pass';

const NOTICE_ICONS: Record<NoticeTone, LucideIcon> = {
  info: Info,
  warn: AlertTriangle,
  fail: AlertCircle,
  pass: CheckCircle2,
};

interface InlineNoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
}

/** A short message in the flow of the page. Tone always comes with an icon, never colour alone. */
export function InlineNotice({ tone = 'info', title, children, onDismiss, action }: InlineNoticeProps) {
  return (
    <div className={cx(styles.notice, styles[tone])} role={tone === 'fail' ? 'alert' : 'status'}>
      <span className={styles.noticeIcon}>
        <Icon icon={NOTICE_ICONS[tone]} />
      </span>
      <div className={styles.noticeText}>
        {title && <p className={styles.noticeTitle}>{title}</p>}
        <div className={styles.noticeBody}>{children}</div>
        {action && <div className={styles.noticeAction}>{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
          <Icon icon={X} size="sm" />
        </button>
      )}
    </div>
  );
}
