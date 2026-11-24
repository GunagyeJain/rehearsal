import {
  GOAL_OPTIONS,
  OTHER_GOAL_ID,
  TIMEFRAME_OPTIONS,
  type BaselineFeedback,
  type OnboardingProfileRequest,
  type TimeframeId,
  type UserProfile,
} from '@rehearsal/shared';

/** The onboarding sequence (spec/screens.md section 2), one screen per step. */
export const ONBOARDING_STEPS = ['goal', 'timeframe', 'field', 'confidence', 'mic', 'baseline', 'feedback', 'path'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const QUESTION_STEPS: readonly OnboardingStep[] = ['goal', 'timeframe', 'field', 'confidence'];

/** The baseline prompt: fixed copy shared with the server (spec/api.md), spoken via /api/tts and shown large. */
export { BASELINE_PROMPT } from '@rehearsal/shared';

export const FIELD_MAX_LENGTH = 120;
export const GOAL_DETAIL_MAX_LENGTH = 300;

export interface OnboardingDraft {
  goal: string | null;
  goalDetail: string;
  timeframe: TimeframeId | null;
  field: string;
  confidence: number | null;
}

/** What survives a reload. Only answers, the step and the two feedback lines: never audio or transcripts. */
export interface SavedOnboarding {
  step: OnboardingStep;
  draft: OnboardingDraft;
  feedback: BaselineFeedback | null;
}

export const EMPTY_DRAFT: OnboardingDraft = { goal: null, goalDetail: '', timeframe: null, field: '', confidence: null };

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) - 1] ?? null;
}

export function nextStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? step;
}

export function isQuestionStep(step: OnboardingStep): boolean {
  return QUESTION_STEPS.includes(step);
}

// ---------------------------------------------------------------- validation

const isGoal = (value: unknown): value is string =>
  typeof value === 'string' && (value === OTHER_GOAL_ID || GOAL_OPTIONS.some((g) => g.id === value));
const isTimeframe = (value: unknown): value is TimeframeId =>
  typeof value === 'string' && TIMEFRAME_OPTIONS.some((t) => t.id === value);
const isConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

/** Whether the answer for a question step is complete enough to continue. */
export function isStepAnswered(step: OnboardingStep, draft: OnboardingDraft): boolean {
  switch (step) {
    case 'goal':
      return draft.goal !== null && (draft.goal !== OTHER_GOAL_ID || draft.goalDetail.trim() !== '');
    case 'timeframe':
      return draft.timeframe !== null;
    case 'field': {
      const field = draft.field.trim();
      return field.length > 0 && field.length <= FIELD_MAX_LENGTH;
    }
    case 'confidence':
      return draft.confidence !== null;
    default:
      return true;
  }
}

/** The first question step still missing an answer, or null when every question is answered. */
export function firstUnansweredStep(draft: OnboardingDraft): OnboardingStep | null {
  return QUESTION_STEPS.find((s) => !isStepAnswered(s, draft)) ?? null;
}

/** The profile request, or null while any question is unanswered. */
export function draftToProfile(draft: OnboardingDraft): OnboardingProfileRequest | null {
  if (!QUESTION_STEPS.every((step) => isStepAnswered(step, draft))) return null;
  if (draft.goal === null || draft.timeframe === null || draft.confidence === null) return null;
  return {
    goal: draft.goal,
    goalDetail: draft.goalDetail.trim(),
    timeframe: draft.timeframe,
    field: draft.field.trim(),
    confidence: draft.confidence,
  };
}

export function draftFromProfile(profile: UserProfile): OnboardingDraft {
  return {
    goal: isGoal(profile.goal) ? profile.goal : null,
    goalDetail: profile.goalDetail,
    timeframe: isTimeframe(profile.timeframe) ? profile.timeframe : null,
    field: profile.field,
    confidence: isConfidence(profile.confidence) ? profile.confidence : null,
  };
}

// ---------------------------------------------------------------- resume

/**
 * Where a reload lands. The server is the source of truth for the profile; local storage only
 * remembers unsaved answers, the current step and the baseline feedback lines.
 */
export function resumeStep(saved: SavedOnboarding | null, profile: UserProfile | null): OnboardingStep {
  // A saved profile with no local state (another device, cleared storage) resumes at the mic step.
  const step = saved?.step ?? (profile ? 'mic' : 'goal');
  if (!profile) {
    if (isQuestionStep(step)) return step;
    const draft = saved?.draft ?? EMPTY_DRAFT;
    return firstUnansweredStep(draft) ?? 'confidence';
  }
  if (step === 'feedback' || step === 'path') return saved?.feedback ? step : 'baseline';
  return step;
}

export function initialDraft(saved: SavedOnboarding | null, profile: UserProfile | null): OnboardingDraft {
  if (saved && isQuestionStep(saved.step)) return saved.draft;
  if (profile) return draftFromProfile(profile);
  return saved?.draft ?? EMPTY_DRAFT;
}

// ---------------------------------------------------------------- storage

const STORAGE_PREFIX = 'rehearsal.onboarding.';

function parseDraft(value: unknown): OnboardingDraft {
  if (typeof value !== 'object' || value === null) return EMPTY_DRAFT;
  const v = value as Record<string, unknown>;
  return {
    goal: isGoal(v.goal) ? v.goal : null,
    goalDetail: typeof v.goalDetail === 'string' ? v.goalDetail.slice(0, GOAL_DETAIL_MAX_LENGTH) : '',
    timeframe: isTimeframe(v.timeframe) ? v.timeframe : null,
    field: typeof v.field === 'string' ? v.field.slice(0, FIELD_MAX_LENGTH) : '',
    confidence: isConfidence(v.confidence) ? v.confidence : null,
  };
}

function parseFeedback(value: unknown): BaselineFeedback | null {
  if (typeof value !== 'object' || value === null) return null;
  const { strength, observation } = value as Record<string, unknown>;
  return typeof strength === 'string' && typeof observation === 'string' ? { strength, observation } : null;
}

/** Narrow whatever is in storage; anything malformed is ignored rather than trusted. */
export function parseSaved(raw: string | null): SavedOnboarding | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const step = ONBOARDING_STEPS.find((s) => s === v.step);
  if (!step) return null;
  return { step, draft: parseDraft(v.draft), feedback: parseFeedback(v.feedback) };
}

/** Storage can be unavailable (private windows, blocked site data); onboarding still works without it. */
export function loadSaved(userId: string): SavedOnboarding | null {
  try {
    return parseSaved(window.localStorage.getItem(STORAGE_PREFIX + userId));
  } catch {
    return null;
  }
}

export function persist(userId: string, state: SavedOnboarding): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(state));
  } catch {
    // Without storage a reload restarts from the server's profile. Nothing else to do.
  }
}

export function clearSaved(userId: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + userId);
  } catch {
    // See persist.
  }
}
