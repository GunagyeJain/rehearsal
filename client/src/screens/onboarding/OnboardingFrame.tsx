import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cx, Icon, ProgressRule, Wordmark } from '../../components';
import { ONBOARDING_STEPS, stepIndex, type OnboardingStep } from './onboardingState';
import styles from './Onboarding.module.css';

interface OnboardingFrameProps {
  step: OnboardingStep;
  /** The question, as the page heading. */
  title: string;
  /** Hide the visible heading when the step draws its own (the baseline prompt). */
  hideTitle?: boolean;
  lead?: ReactNode;
  /** Omit to hide Back (first step, or once the path exists). */
  onBack?: () => void;
  backDisabled?: boolean;
  /** Wraps the content in a form, so Enter continues. */
  onSubmit?: () => void;
  actions?: ReactNode;
  /** 'stage' centres a single large element (baseline recording). */
  layout?: 'reading' | 'stage';
  children?: ReactNode;
}

const APP_NAME = 'Rehearsal';

/**
 * One onboarding screen: thin progress rule at the very top, a quiet Back, the question as the
 * heading, then the answer. Focus moves to the heading on every step so screen readers follow.
 */
export function OnboardingFrame({
  step,
  title,
  hideTitle = false,
  lead,
  onBack,
  backDisabled = false,
  onSubmit,
  actions,
  layout = 'reading',
  children,
}: OnboardingFrameProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const position = stepIndex(step);

  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };

  const body = (
    <>
      <div className={styles.content}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </>
  );

  return (
    <div className={styles.shell}>
      <ProgressRule value={position} total={ONBOARDING_STEPS.length} label="Onboarding progress" fixed />
      <header className={styles.header}>
        <div className={styles.headerInner}>
          {onBack ? (
            <button type="button" className={styles.back} onClick={onBack} disabled={backDisabled}>
              <Icon icon={ArrowLeft} size="sm" />
              <span>Back</span>
            </button>
          ) : (
            <Wordmark />
          )}
          <p className={styles.count} aria-hidden="true">
            {position + 1} / {ONBOARDING_STEPS.length}
          </p>
        </div>
      </header>
      <main id="main" className={cx(styles.main, layout === 'stage' && styles.stageMain)}>
        <div key={step} className={styles.step}>
          <div className={hideTitle ? 'visually-hidden' : styles.titleBlock}>
            {/* The header count and progress rule show the step; this keeps it in the reading order. */}
            <p className="visually-hidden">
              Step {position + 1} of {ONBOARDING_STEPS.length}
            </p>
            <h1 ref={headingRef} className={styles.title} tabIndex={-1}>
              {title}
            </h1>
            {lead && <div className={styles.lead}>{lead}</div>}
          </div>
          {onSubmit ? (
            <form className={styles.form} onSubmit={submit} noValidate>
              {body}
            </form>
          ) : (
            <div className={styles.form}>{body}</div>
          )}
        </div>
      </main>
    </div>
  );
}
