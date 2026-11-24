/** Shared numeric constants. Changing any of these changes scoring. */

/** Gaps longer than this are "long pauses": excluded from speaking time, counted in pauseCount2s, marked amber. */
export const LONG_PAUSE_SEC = 2;

/** Window length for the waveform pace band. */
export const PACE_WINDOW_SEC = 10;

/** Words either side of an ambiguous filler sent to the judge as context. */
export const AMBIGUOUS_CONTEXT_WORDS = 6;

/** Skip button appears once a non-passed scenario has this many attempts. */
export const SKIP_AFTER_ATTEMPTS = 3;

/** Path length bounds (spec/scoring.md). */
export const PATH_MIN_ITEMS = 8;
export const PATH_MAX_ITEMS = 12;

/** The calibration scenario every path starts with. */
export const CALIBRATION_SCENARIO_ID = 'self-introduction';

/** Generated AI lines are capped at this many words (spec/scenario-schema.md). */
export const MAX_GENERATED_WORDS = 40;

/** Baseline recording bounds (onboarding). */
export const BASELINE_MAX_SECONDS = 120;
export const BASELINE_MIN_SECONDS = 20;

/**
 * Phase 0 finding: Whisper segment avg_logprob below this means the audio was
 * genuinely unintelligible. Reject the take (re-record) rather than score it.
 */
export const TRANSCRIPT_MIN_AVG_LOGPROB = -0.6;

/** Upload cap for a single audio answer. */
export const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;
