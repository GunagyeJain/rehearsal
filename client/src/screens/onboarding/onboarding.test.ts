import { describe, expect, it } from 'vitest';
import type { UserProfile } from '@rehearsal/shared';
import { detectBrowser, micHelpFor } from '../../audio/micHelp';
import {
  EMPTY_DRAFT,
  clearSaved,
  draftToProfile,
  initialDraft,
  isStepAnswered,
  loadSaved,
  nextStep,
  parseSaved,
  persist,
  previousStep,
  resumeStep,
  type OnboardingDraft,
  type SavedOnboarding,
} from './onboardingState';

const PROFILE: UserProfile = { goal: 'job-interview', goalDetail: '', timeframe: 'this-month', field: 'Nursing', confidence: 3 };
const FULL: OnboardingDraft = { goal: 'viva', goalDetail: '', timeframe: 'this-term', field: 'History', confidence: 2 };
const FEEDBACK = { strength: 'You kept going.', observation: 'Try one clear closing line.' };

describe('step order', () => {
  it('walks goal to path and back', () => {
    expect(nextStep('goal')).toBe('timeframe');
    expect(nextStep('confidence')).toBe('mic');
    expect(nextStep('path')).toBe('path');
    expect(previousStep('goal')).toBeNull();
    expect(previousStep('baseline')).toBe('mic');
  });
});

describe('answers', () => {
  it('requires detail for "Something else"', () => {
    expect(isStepAnswered('goal', { ...EMPTY_DRAFT, goal: 'other', goalDetail: '  ' })).toBe(false);
    expect(isStepAnswered('goal', { ...EMPTY_DRAFT, goal: 'other', goalDetail: 'A debate' })).toBe(true);
    expect(isStepAnswered('goal', { ...EMPTY_DRAFT, goal: 'viva' })).toBe(true);
  });

  it('requires a non-blank field', () => {
    expect(isStepAnswered('field', { ...EMPTY_DRAFT, field: '   ' })).toBe(false);
    expect(isStepAnswered('field', { ...EMPTY_DRAFT, field: 'Law' })).toBe(true);
  });

  it('builds a trimmed profile only when every question is answered', () => {
    expect(draftToProfile({ ...FULL, confidence: null })).toBeNull();
    expect(draftToProfile({ ...FULL, field: '  History  ' })).toEqual({ ...FULL, field: 'History' });
  });
});

describe('resume after a reload', () => {
  const saved = (patch: Partial<SavedOnboarding>): SavedOnboarding => ({ step: 'goal', draft: EMPTY_DRAFT, feedback: null, ...patch });

  it('starts at the goal with nothing saved', () => {
    expect(resumeStep(null, null)).toBe('goal');
  });

  it('returns to the saved question before the profile exists', () => {
    expect(resumeStep(saved({ step: 'field' }), null)).toBe('field');
  });

  it('never skips past the questions without a saved profile', () => {
    expect(resumeStep(saved({ step: 'baseline', draft: { ...FULL, field: '' } }), null)).toBe('field');
    expect(resumeStep(saved({ step: 'mic', draft: FULL }), null)).toBe('confidence');
  });

  it('resumes at the mic step when the profile exists but nothing is stored locally', () => {
    expect(resumeStep(null, PROFILE)).toBe('mic');
  });

  it('resumes the mic and baseline steps once the profile is saved', () => {
    expect(resumeStep(saved({ step: 'mic' }), PROFILE)).toBe('mic');
    expect(resumeStep(saved({ step: 'baseline' }), PROFILE)).toBe('baseline');
  });

  it('shows feedback or the path only when the feedback lines survived', () => {
    expect(resumeStep(saved({ step: 'feedback', feedback: FEEDBACK }), PROFILE)).toBe('feedback');
    expect(resumeStep(saved({ step: 'path', feedback: FEEDBACK }), PROFILE)).toBe('path');
    expect(resumeStep(saved({ step: 'feedback' }), PROFILE)).toBe('baseline');
  });

  it('prefers unsaved edits on a question step, otherwise the server profile', () => {
    expect(initialDraft(saved({ step: 'field', draft: FULL }), PROFILE)).toEqual(FULL);
    expect(initialDraft(saved({ step: 'baseline', draft: FULL }), PROFILE)).toMatchObject({ goal: 'job-interview', field: 'Nursing' });
    expect(initialDraft(null, null)).toEqual(EMPTY_DRAFT);
  });
});

describe('storage', () => {
  it('round-trips per user and clears', () => {
    const state: SavedOnboarding = { step: 'feedback', draft: FULL, feedback: FEEDBACK };
    persist('u1', state);
    expect(loadSaved('u1')).toEqual(state);
    expect(loadSaved('u2')).toBeNull();
    clearSaved('u1');
    expect(loadSaved('u1')).toBeNull();
  });

  it('ignores malformed or tampered values', () => {
    expect(parseSaved('not json')).toBeNull();
    expect(parseSaved(JSON.stringify({ step: 'nowhere' }))).toBeNull();
    const parsed = parseSaved(JSON.stringify({ step: 'goal', draft: { goal: 'hack', confidence: 9, field: 7 }, feedback: { strength: 1 } }));
    expect(parsed).toEqual({ step: 'goal', draft: EMPTY_DRAFT, feedback: null });
  });
});

describe('mic help', () => {
  const UA = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  };

  it('detects each browser family', () => {
    expect(detectBrowser(UA.chrome)).toBe('chrome');
    expect(detectBrowser(UA.edge)).toBe('edge');
    expect(detectBrowser(UA.firefox)).toBe('firefox');
    expect(detectBrowser(UA.safari)).toBe('safari');
    expect(detectBrowser(UA.ios)).toBe('safari-ios');
    expect(detectBrowser('curl/8')).toBe('other');
  });

  it('always ends with a reload step', () => {
    for (const ua of Object.values(UA)) expect(micHelpFor(ua).steps.at(-1)).toBe('Reload this page.');
  });
});
