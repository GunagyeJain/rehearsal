import { ArrowRight } from 'lucide-react';
import {
  CONFIDENCE_LABELS,
  GOAL_OPTIONS,
  OTHER_GOAL_ID,
  TIMEFRAME_OPTIONS,
  type TimeframeId,
} from '@rehearsal/shared';
import { Button, InlineNotice, RadioCards, Scale, TextInput, Textarea, type RadioCardOption } from '../../components';
import { OnboardingFrame } from './OnboardingFrame';
import {
  FIELD_MAX_LENGTH,
  GOAL_DETAIL_MAX_LENGTH,
  isStepAnswered,
  type OnboardingDraft,
  type OnboardingStep,
} from './onboardingState';
import styles from './Onboarding.module.css';

export interface QuestionStepProps {
  step: OnboardingStep;
  draft: OnboardingDraft;
  onChange: (patch: Partial<OnboardingDraft>) => void;
  onBack?: () => void;
  onContinue: () => void;
  /** True while the profile is being saved (confidence step). */
  saving?: boolean;
  error?: string | null;
}

const GOAL_CARDS: readonly RadioCardOption<string>[] = [
  ...GOAL_OPTIONS.map((g) => ({ value: g.id, label: g.label })),
  { value: OTHER_GOAL_ID, label: 'Something else' },
];

const TIMEFRAME_CARDS: readonly RadioCardOption<TimeframeId>[] = TIMEFRAME_OPTIONS.map((t) => ({ value: t.id, label: t.label }));

interface QuestionCopy {
  title: string;
  lead: string;
}

const COPY: Partial<Record<OnboardingStep, QuestionCopy>> = {
  goal: { title: 'What are you preparing for?', lead: 'Your path is built around this. Pick the closest.' },
  timeframe: { title: 'When is it?', lead: 'This sets how the questions are framed, not how fast you go.' },
  field: { title: 'What do you study or work in?', lead: 'Questions are written for your field, so they sound like the real thing.' },
  confidence: { title: 'How confident do you feel speaking right now?', lead: 'There is no right answer. It only sets where you start.' },
};

function QuestionBody({ step, draft, onChange }: Pick<QuestionStepProps, 'step' | 'draft' | 'onChange'>) {
  const title = COPY[step]?.title ?? '';
  switch (step) {
    case 'goal':
      return (
        <RadioCards
          legend={title}
          hideLegend
          options={GOAL_CARDS}
          value={draft.goal}
          onChange={(goal) => onChange({ goal })}
          footer={
            draft.goal === OTHER_GOAL_ID ? (
              <div className={styles.detail}>
                <Textarea
                  label="Describe it in a sentence"
                  rows={2}
                  maxLength={GOAL_DETAIL_MAX_LENGTH}
                  value={draft.goalDetail}
                  onChange={(e) => onChange({ goalDetail: e.target.value })}
                  placeholder="A debate final, a wedding speech, a podcast interview"
                  autoFocus
                />
              </div>
            ) : null
          }
        />
      );
    case 'timeframe':
      return (
        <RadioCards
          legend={title}
          hideLegend
          options={TIMEFRAME_CARDS}
          value={draft.timeframe}
          onChange={(timeframe) => onChange({ timeframe })}
        />
      );
    case 'field':
      return (
        <TextInput
          label="Field or subject"
          maxLength={FIELD_MAX_LENGTH}
          value={draft.field}
          onChange={(e) => onChange({ field: e.target.value })}
          placeholder="Mechanical engineering, nursing, product design"
          autoComplete="off"
          autoFocus
        />
      );
    case 'confidence':
      return (
        <Scale
          legend={title}
          hideLegend
          lowLabel={CONFIDENCE_LABELS.low}
          highLabel={CONFIDENCE_LABELS.high}
          value={draft.confidence}
          onChange={(confidence) => onChange({ confidence })}
        />
      );
    default:
      return null;
  }
}

/** Goal, timeframe, field and confidence: one question per screen. */
export function QuestionStep({ step, draft, onChange, onBack, onContinue, saving = false, error }: QuestionStepProps) {
  const copy = COPY[step] ?? { title: '', lead: '' };
  const answered = isStepAnswered(step, draft);
  return (
    <OnboardingFrame
      step={step}
      title={copy.title}
      lead={copy.lead}
      onBack={onBack}
      backDisabled={saving}
      onSubmit={() => {
        if (answered && !saving) onContinue();
      }}
      actions={
        <Button type="submit" icon={ArrowRight} iconPosition="end" disabled={!answered} loading={saving}>
          Continue
        </Button>
      }
    >
      <QuestionBody step={step} draft={draft} onChange={onChange} />
      {error && <InlineNotice tone="fail">{error}</InlineNotice>}
    </OnboardingFrame>
  );
}
