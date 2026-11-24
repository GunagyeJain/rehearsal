import type { ObjectiveMetric, TrackId, UserInputValues } from './scenario';

/** Domain types shared by server and client. Mirrors spec/data-model.md. Ids are strings on the wire. */

/** One word from Groq Whisper verbose_json, seconds relative to the start of that turn's audio. */
export interface Word {
  word: string;
  start: number;
  end: number;
}

/** A filler occurrence. start/end are relative to the turn's audio, so markers line up with that recording. */
export interface FillerMark {
  word: string;
  start: number;
  end: number;
  turnIndex: number;
  /** Index of the first word of the filler within that turn's words array. */
  wordIndex: number;
  /** Number of consecutive words the filler spans ("you know" = 2). */
  wordCount: number;
}

/** A gap over LONG_PAUSE_SEC between two words, within one turn. */
export interface PauseMark {
  start: number;
  end: number;
  durationSec: number;
  turnIndex: number;
  /** Index of the word that ends just before the pause. */
  afterWordIndex: number;
}

/** WPM over one PACE_WINDOW_SEC window of one turn. Drives the report's pace band. */
export interface PaceWindow {
  turnIndex: number;
  start: number;
  end: number;
  wpm: number;
  /** True when the window is shorter than the full window length (the tail of the answer). */
  partial: boolean;
}

/** An ambiguous word ("like", "so", ...) awaiting a judge ruling. `id` is unique within the attempt. */
export interface AmbiguousCandidate {
  id: number;
  word: string;
  turnIndex: number;
  wordIndex: number;
  wordCount: number;
  start: number;
  end: number;
  /** Surrounding words with the candidate wrapped in [brackets], for the judge. */
  context: string;
}

/** The judge's verdict on one ambiguous candidate. */
export interface FillerRuling {
  id: number;
  isFiller: boolean;
}

/** Objective metric values, keyed by the rubric metric names. */
export type MetricValues = Readonly<Record<ObjectiveMetric, number>>;

/** Objective metrics for an attempt (all turns combined). Stored on the attempt. */
export interface Metrics extends MetricValues {
  wpm: number;
  fillersPerMinute: number;
  longestPauseSec: number;
  pauseCount2s: number;
  durationSec: number;
  speakingSec: number;
  wordCount: number;
  contentWordCount: number;
  fillerCount: number;
  fillerMarks: FillerMark[];
  pauseMarks: PauseMark[];
  paceWindows: PaceWindow[];
}

/** Output of computeMetrics / computeAttemptMetrics: metrics plus candidates still needing a ruling. */
export interface MetricsAnalysis {
  metrics: Metrics;
  ambiguous: AmbiguousCandidate[];
}

export type CriterionKind = 'objective' | 'judged';

export interface CriterionResult {
  id: string;
  label: string;
  kind: CriterionKind;
  passed: boolean;
  /** Plain-language line, e.g. "184 wpm, target 120-170". For judged criteria, the evidence or an unavailable note. */
  detail: string;
  /** Objective only. */
  metric?: ObjectiveMetric;
  actual?: number;
  /** Objective only: human-readable target, e.g. "120-170 wpm". */
  target?: string;
}

export interface Verdict {
  criteria: CriterionResult[];
  passedCount: number;
  totalCount: number;
  passed: boolean;
  /** Strength, quoting what the user said. Empty string when the judge was unavailable. */
  evidence: string;
  /** One sentence, one action. */
  nextAction: string;
  /** True when the Claude call failed and judged criteria were auto-passed. */
  judgeUnavailable: boolean;
}

export interface AttemptTurn {
  index: number;
  /** The generated line, as spoken. */
  aiText: string;
  /** GridFS recording id of the user's answer; null when not yet uploaded or deleted. */
  audioId: string | null;
  transcript: string;
  words: Word[];
  /** Seconds of audio actually recorded for this answer. */
  audioDurationSec?: number;
}

export type AttemptStatus = 'in_progress' | 'scoring' | 'scored' | 'abandoned';

export interface Attempt {
  id: string;
  scenarioId: string;
  userInputs: UserInputValues;
  status: AttemptStatus;
  startedAt: string;
  completedAt: string | null;
  turns: AttemptTurn[];
  metrics: Metrics | null;
  verdict: Verdict | null;
}

export type ProgressStatus = 'locked' | 'available' | 'failed' | 'passed' | 'skipped';

export interface Progress {
  scenarioId: string;
  status: ProgressStatus;
  attemptCount: number;
  bestAttemptId: string | null;
  unlockedAt: string | null;
}

/** Home-screen row. All flags are derived server-side; never stored. */
export interface PathItem {
  position: number;
  scenarioId: string;
  title: string;
  track: TrackId;
  difficulty: number;
  state: ProgressStatus;
  attemptCount: number;
  canSkip: boolean;
  /** True for the single row the user should do next. */
  isCurrent: boolean;
  lastAttemptId: string | null;
  bestAttemptId: string | null;
}

export type ThemeSetting = 'light' | 'dark' | 'system';
export type FontSetting = 'serif' | 'sans' | 'mono';

export interface UserSettings {
  theme: ThemeSetting;
  font: FontSetting;
  showTranscript: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  font: 'serif',
  showTranscript: true,
};

export interface UserProfile {
  /** Goal option id, or 'other'. */
  goal: string;
  /** Free text detail ("What are you preparing for?"). */
  goalDetail: string;
  timeframe: string;
  field: string;
  /** Self-rated 1-5. */
  confidence: number;
}

export interface User {
  id: string;
  email: string;
  createdAt: string;
  profile: UserProfile | null;
  settings: UserSettings;
  /** True once the path has been generated. */
  onboarded: boolean;
}
