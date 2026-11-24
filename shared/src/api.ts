import { z } from 'zod';
import type {
  AmbiguousCandidate,
  Attempt,
  CriterionResult,
  Metrics,
  PathItem,
  ProgressStatus,
  User,
  UserProfile,
  UserSettings,
  Word,
} from './domain';
import type { ProfileInput, profilePatchSchema } from './onboarding';
import type { Rubric, Scenario, TrackId } from './scenario';

/**
 * Request/response DTOs for every endpoint in spec/api.md.
 * Success bodies are returned bare (no envelope). Errors always use ApiErrorBody.
 */

// ------------------------------------------------------------------ errors

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'PROFILE_REQUIRED',
  'PATH_EXISTS',
  'PATH_REQUIRED',
  'ATTEMPT_CLOSED',
  'TURN_OUT_OF_ORDER',
  'PREVIOUS_ANSWER_REQUIRED',
  'TURNS_INCOMPLETE',
  'NO_SPEECH',
  'TRANSCRIPT_UNRELIABLE',
  'MISSING_TIMESTAMPS',
  'SKIP_NOT_ALLOWED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Safe, user-presentable message. Never contains transcripts, audio or secrets. */
    message: string;
    /** Field errors for VALIDATION_FAILED, keyed by field path. */
    fields?: Record<string, string>;
  };
}

// ------------------------------------------------------------------ health

export interface HealthResponse {
  ok: boolean;
  mongo: 'up' | 'down';
  scenarioCount: number;
}

// ------------------------------------------------------------------ auth

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt only reads the first 72 bytes, so longer passwords would silently match on a prefix. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MAX_LENGTH = PASSWORD_MAX_BYTES;

const UTF8_ONE_BYTE_MAX = 0x7f;
const UTF8_TWO_BYTE_MAX = 0x7ff;
const UTF8_THREE_BYTE_MAX = 0xffff;

/** UTF-8 length without TextEncoder (shared has no DOM or Node lib). A lone surrogate counts 3, as U+FFFD does. */
export function passwordByteLength(password: string): number {
  let bytes = 0;
  for (const ch of password) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp <= UTF8_ONE_BYTE_MAX ? 1 : cp <= UTF8_TWO_BYTE_MAX ? 2 : cp <= UTF8_THREE_BYTE_MAX ? 3 : 4;
  }
  return bytes;
}

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((p) => passwordByteLength(p) <= PASSWORD_MAX_BYTES, { message: `must be at most ${PASSWORD_MAX_BYTES} bytes` });

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
});
export type CredentialsRequest = z.input<typeof credentialsSchema>;

/** POST /api/auth/signup, POST /api/auth/signin, GET /api/auth/me */
export interface AuthUserResponse {
  user: User;
}

/** DELETE /api/account */
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
export type DeleteAccountRequest = z.input<typeof deleteAccountSchema>;

// ------------------------------------------------------------------ users

/** GET /api/users/me */
export interface MeResponse {
  user: User;
}

export const settingsPatchSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    font: z.enum(['serif', 'sans', 'mono']),
    showTranscript: z.boolean(),
  })
  .partial()
  .strict();
/** PATCH /api/users/me/settings */
export type SettingsPatchRequest = z.input<typeof settingsPatchSchema>;
export interface SettingsResponse {
  settings: UserSettings;
}

/** PATCH /api/users/me/profile: any subset of the onboarding profile. */
export type ProfilePatchRequest = z.input<typeof profilePatchSchema>;
export interface ProfileResponse {
  profile: UserProfile;
}

// ------------------------------------------------------------------ onboarding

/** PUT /api/onboarding/profile */
export type OnboardingProfileRequest = ProfileInput;
export type OnboardingProfileResponse = AuthUserResponse;

/** The subset of metrics shown for the baseline. */
export type BaselineMetrics = Pick<
  Metrics,
  'wpm' | 'fillersPerMinute' | 'fillerCount' | 'longestPauseSec' | 'pauseCount2s' | 'durationSec' | 'wordCount'
>;

export interface BaselineFeedback {
  /** One strength, from real metrics or the transcript. */
  strength: string;
  /** One observation. Not a verdict. */
  observation: string;
}

/** POST /api/onboarding/baseline (multipart: audio, durationSec) */
export interface BaselineResponse {
  transcript: string;
  words: Word[];
  metrics: BaselineMetrics;
  feedback: BaselineFeedback;
  recordingId: string;
}

/** POST /api/onboarding/path */
export interface GeneratePathResponse {
  path: PathView;
  /** True when Claude failed and the default path was used. */
  fallback: boolean;
}

// ------------------------------------------------------------------ path

export interface PathView {
  items: PathItem[];
  clearedCount: number;
  totalCount: number;
  complete: boolean;
  generatedAt: string;
  completedAt: string | null;
}

/** GET /api/path. path is null before onboarding finishes. */
export interface PathResponse {
  path: PathView | null;
}

/** POST /api/path/:scenarioId/skip */
export type SkipResponse = PathResponse;

// ------------------------------------------------------------------ scenarios

export interface ScenarioSummary {
  id: string;
  track: TrackId;
  title: string;
  description: string;
  difficulty: number;
  turnCount: number;
  expectedDurationSec: number;
  hasSetup: boolean;
  onPath: boolean;
  /** The user's state for this scenario; null when never attempted and not on the path. */
  state: ProgressStatus | null;
  attemptCount: number;
}

export interface TrackGroup {
  track: TrackId;
  label: string;
  scenarios: ScenarioSummary[];
}

/** GET /api/scenarios */
export interface ScenarioListResponse {
  tracks: TrackGroup[];
}

/** Turn as exposed to the client: the generation prompt stays server-side. */
export type PublicScenarioTurn = Omit<Scenario['turns'][number], 'generate'>;

export type PublicScenario = Omit<Scenario, 'turns'> & {
  description: string;
  turns: PublicScenarioTurn[];
};

/** GET /api/scenarios/:id */
export interface ScenarioDetailResponse {
  scenario: PublicScenario;
  summary: ScenarioSummary;
  canSkip: boolean;
}

// ------------------------------------------------------------------ attempts

export const startAttemptSchema = z.object({
  scenarioId: z.string().min(1).max(80),
  userInputs: z.record(z.string(), z.string().max(2000)).default({}),
});
/** POST /api/attempts */
export type StartAttemptRequest = z.input<typeof startAttemptSchema>;

export interface GeneratedTurn {
  index: number;
  text: string;
}

export interface StartAttemptResponse {
  attemptId: string;
  /** Turn 0's line, already generated. */
  turn: GeneratedTurn;
}

/** POST /api/attempts/:id/turns/:turnIndex/generate */
export type GenerateTurnResponse = GeneratedTurn;

/** The onboarding baseline prompt: fixed copy, the only TTS line not taken from an attempt. */
export const BASELINE_PROMPT = "Tell me who you are and what you're preparing for.";

/**
 * POST /api/tts speaks only text the server already knows: a stored attempt line (scoped to the
 * user) or a fixed prompt. It never synthesizes client-supplied text.
 */
export const ttsRequestSchema = z.union([
  z
    .object({
      attemptId: z.string().regex(/^[0-9a-f]{24}$/i),
      turnIndex: z.number().int().min(0).max(99),
    })
    .strict(),
  z.object({ prompt: z.literal('baseline') }).strict(),
]);
/** POST /api/tts -> audio/wav bytes */
export type TtsRequest = z.input<typeof ttsRequestSchema>;

/** POST /api/attempts/:id/turns/:turnIndex/answer (multipart: audio, durationSec) */
export interface UploadAnswerResponse {
  turn: {
    index: number;
    transcript: string;
    words: Word[];
    audioId: string;
  };
  /** Whether every turn now has an answer; when true the client calls finalize. */
  allTurnsAnswered: boolean;
}

/** Objective results shown while the judge is still running. */
export interface ProvisionalReport {
  metrics: Metrics;
  objective: CriterionResult[];
  /** Ambiguous fillers awaiting a ruling: the fillers line may still go up. */
  ambiguous: Pick<AmbiguousCandidate, 'id' | 'word' | 'turnIndex' | 'wordIndex'>[];
}

export interface AttemptProgressInfo {
  status: ProgressStatus;
  attemptCount: number;
  canSkip: boolean;
  /** Next path item to continue to when passed; null when off-path or at the end. */
  nextScenarioId: string | null;
  onPath: boolean;
}

export interface ScenarioRef {
  id: string;
  title: string;
  track: TrackId;
  rubric: Rubric;
  criteriaDisplay: string[];
}

/** POST /api/attempts/:id/finalize and GET /api/attempts/:id */
export interface AttemptDetailResponse {
  attempt: Attempt;
  scenario: ScenarioRef;
  /** Present while attempt.status === 'scoring'. */
  provisional: ProvisionalReport | null;
  progress: AttemptProgressInfo;
}

export type FinalizeAttemptResponse = AttemptDetailResponse;

export const TREND_METRICS = ['wpm', 'fillersPerMinute', 'longestPauseSec', 'durationSec'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export interface AttemptHistoryEntry {
  id: string;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  passedCount: number;
  totalCount: number;
  judgeUnavailable: boolean;
  metrics: Pick<Metrics, TrendMetric>;
}

export interface AttemptHistoryGroup {
  scenario: { id: string; title: string; track: TrackId };
  /** Newest first. */
  attempts: AttemptHistoryEntry[];
  /** Oldest to newest, one value per scored attempt, for the trend sparkline. */
  trend: Record<TrendMetric, number[]>;
  /** Rubric targets for the trend metrics, when the scenario's rubric uses them. */
  targets: Partial<Record<TrendMetric, { op: 'lte' | 'gte' | 'between'; value: number | [number, number] }>>;
}

/** GET /api/attempts?scenarioId= */
export interface AttemptHistoryResponse {
  /** Groups ordered by most recent attempt first. */
  groups: AttemptHistoryGroup[];
}

// ------------------------------------------------------------------ recordings

export interface RecordingSummary {
  id: string;
  kind: 'attempt' | 'baseline';
  attemptId: string | null;
  scenarioId: string | null;
  scenarioTitle: string | null;
  turnIndex: number | null;
  mimeType: string;
  durationSec: number;
  sizeBytes: number;
  createdAt: string;
}

/** GET /api/recordings */
export interface RecordingListResponse {
  count: number;
  totalBytes: number;
  recordings: RecordingSummary[];
}

/** DELETE /api/account/recordings */
export interface DeleteAllRecordingsResponse {
  deletedCount: number;
}

// ------------------------------------------------------------------ helpers

/** Route paths, so client and server agree on spelling. */
export const API_BASE = '/api';


