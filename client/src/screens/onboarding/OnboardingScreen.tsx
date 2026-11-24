import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BaselineFeedback, BaselineResponse, User } from '@rehearsal/shared';
import { isApiError } from '../../api/client';
import { useAuth } from '../../auth/authContext';
import { ROUTES } from '../../routes';
import { scenarioHref } from '../../path/scenarioHref';
import { saveOnboardingProfile } from '../../path/pathApi';
import { BaselineStep } from './BaselineStep';
import { FeedbackStep } from './FeedbackStep';
import { MicStep } from './MicStep';
import { PathRevealStep } from './PathRevealStep';
import { QuestionStep } from './QuestionSteps';
import {
  clearSaved,
  draftToProfile,
  firstUnansweredStep,
  initialDraft,
  isQuestionStep,
  loadSaved,
  nextStep,
  persist,
  previousStep,
  resumeStep,
  type OnboardingDraft,
  type OnboardingStep,
} from './onboardingState';

/** The signed-in, not yet onboarded user (RequireAuth 'pending' guarantees it). */
function useOnboardingUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('OnboardingScreen rendered without a signed-in user');
  return user;
}

/**
 * Onboarding (spec/screens.md section 2). Answers, the step and the feedback lines are kept in
 * local storage per user, so a reload resumes at the same step; the profile itself lives on the server.
 */
export function OnboardingScreen() {
  const user = useOnboardingUser();
  const { updateUser, reload } = useAuth();
  const navigate = useNavigate();
  const [initial] = useState(() => {
    const saved = loadSaved(user.id);
    return {
      step: resumeStep(saved, user.profile),
      draft: initialDraft(saved, user.profile),
      feedback: saved?.feedback ?? null,
    };
  });
  const [step, setStep] = useState<OnboardingStep>(initial.step);
  const [draft, setDraft] = useState<OnboardingDraft>(initial.draft);
  const [feedback, setFeedback] = useState<BaselineFeedback | null>(initial.feedback);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    persist(user.id, { step, draft, feedback });
  }, [user.id, step, draft, feedback]);

  const goBack = useCallback(() => {
    setSaveError(null);
    setStep((current) => previousStep(current) ?? current);
  }, []);

  const changeDraft = useCallback((patch: Partial<OnboardingDraft>) => {
    setSaveError(null);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const saveProfile = async () => {
    const profile = draftToProfile(draft);
    if (!profile) {
      // An answer was dropped on resume (for example an option that no longer exists): go back to it.
      setStep(firstUnansweredStep(draft) ?? 'goal');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { user: updated } = await saveOnboardingProfile(profile);
      updateUser(() => updated);
      setStep('mic');
    } catch (error: unknown) {
      if (isApiError(error) && error.code === 'PATH_EXISTS') {
        reload();
        return;
      }
      setSaveError(isApiError(error) ? error.message : 'Your answers could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const onBaselineDone = useCallback((result: BaselineResponse) => {
    setFeedback(result.feedback);
    setStep('feedback');
  }, []);

  const finish = (destination: 'first' | 'home', firstScenarioId: string | null) => {
    clearSaved(user.id);
    // Queue the user update, then navigate with flushSync so both commit in one render. Otherwise
    // the router's transition lags and this route's 'pending' guard redirects home first.
    updateUser((current) => ({ ...current, onboarded: true }));
    navigate(destination === 'first' && firstScenarioId ? scenarioHref(firstScenarioId) : ROUTES.home, {
      replace: true,
      flushSync: true,
    });
  };

  if (isQuestionStep(step)) {
    return (
      <QuestionStep
        step={step}
        draft={draft}
        onChange={changeDraft}
        onBack={step === 'goal' ? undefined : goBack}
        onContinue={step === 'confidence' ? () => void saveProfile() : () => setStep(nextStep(step))}
        saving={saving}
        error={saveError}
      />
    );
  }
  if (step === 'mic') return <MicStep onBack={goBack} onGranted={() => setStep('baseline')} />;
  if (step === 'baseline') {
    return <BaselineStep onBack={goBack} onDone={onBaselineDone} onClosed={user.profile ? reload : () => setStep('confidence')} />;
  }
  if (step === 'feedback' && feedback) {
    return <FeedbackStep feedback={feedback} onBack={() => setStep('baseline')} onContinue={() => setStep('path')} />;
  }
  return <PathRevealStep onBack={() => setStep(feedback ? 'feedback' : 'baseline')} onFinish={finish} />;
}
