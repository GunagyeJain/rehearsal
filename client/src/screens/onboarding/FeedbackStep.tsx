import { ArrowRight } from 'lucide-react';
import type { BaselineFeedback } from '@rehearsal/shared';
import { Button } from '../../components';
import { OnboardingFrame } from './OnboardingFrame';
import styles from './Onboarding.module.css';

interface FeedbackStepProps {
  feedback: BaselineFeedback;
  onBack: () => void;
  onContinue: () => void;
}

/** Exactly two lines, one strength and one observation, then a single Continue (spec/scoring.md). */
export function FeedbackStep({ feedback, onBack, onContinue }: FeedbackStepProps) {
  return (
    <OnboardingFrame
      step="feedback"
      title="Here is a first read"
      onBack={onBack}
      actions={
        <Button icon={ArrowRight} iconPosition="end" onClick={onContinue} autoFocus>
          Continue
        </Button>
      }
    >
      <dl className={styles.feedback}>
        <div className={styles.feedbackLine} data-tone="strength">
          <dt>What is working</dt>
          <dd>{feedback.strength}</dd>
        </div>
        <div className={styles.feedbackLine} data-tone="observation">
          <dt>One thing to try</dt>
          <dd>{feedback.observation}</dd>
        </div>
      </dl>
    </OnboardingFrame>
  );
}
