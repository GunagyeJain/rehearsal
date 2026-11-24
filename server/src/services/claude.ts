import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  CALIBRATION_SCENARIO_ID,
  GOAL_OPTIONS,
  MAX_GENERATED_WORDS,
  PATH_MAX_ITEMS,
  PATH_MIN_ITEMS,
  firstSentence,
  type AmbiguousCandidate,
  type BaselineFeedback,
  type BaselineMetrics,
  type FillerRuling,
  type JudgedCriterion,
  type JudgedOutcome,
  type Metrics,
  type ProfileInput,
  type TrackId,
  type UserInputValues,
} from '@rehearsal/shared';

/**
 * All Anthropic calls live here (spec/api.md "Service configuration").
 * Model choices are pinned: a judge model change is a rubric change.
 */
export const CLAUDE_MODELS = {
  judge: 'claude-opus-5',
  turnGeneration: 'claude-sonnet-5',
  baselineFeedback: 'claude-sonnet-5',
  pathGeneration: 'claude-opus-5',
} as const;

export const JUDGE_MAX_TOKENS = 16_000;
const TURN_MAX_TOKENS = 4_000;
const FEEDBACK_MAX_TOKENS = 4_000;
const JUDGE_TIMEOUT_MS = 60_000;
const FAST_TIMEOUT_MS = 20_000;

export interface TranscriptTurn {
  index: number;
  aiText: string;
  transcript: string;
  /** The scenario turn's persona; labels the AI line for the judge. */
  persona?: string;
}

export interface GenerateTurnInput {
  /** The scenario turn's `generate` slot. */
  generate: string;
  persona: string;
  /** Brief with {{key}} already interpolated. */
  scene: string;
  yourGoal: string;
  userInputs: UserInputValues;
  profile: Pick<ProfileInput, 'goal' | 'goalDetail' | 'field'> | null;
  /** Earlier turns of this attempt only. */
  previousTurns: readonly TranscriptTurn[];
}

export interface JudgeInput {
  criteria: readonly JudgedCriterion[];
  turns: readonly TranscriptTurn[];
  /** First-pass metrics, context only. */
  metrics: Metrics;
  ambiguous: readonly Pick<AmbiguousCandidate, 'id' | 'word' | 'context'>[];
}

/** Parsed judge output (spec/api.md judge schema). */
export interface JudgeOutput {
  criteria: JudgedOutcome[];
  evidence: string;
  nextAction: string;
  fillerRulings: FillerRuling[];
}

export interface BaselineFeedbackInput {
  transcript: string;
  metrics: BaselineMetrics;
}

export interface PathCandidate {
  id: string;
  track: TrackId;
  title: string;
  difficulty: number;
  description: string;
}

export interface PathGenerationInput {
  profile: ProfileInput;
  baseline: BaselineMetrics | null;
  library: readonly PathCandidate[];
  /** The track the 60% rule applies to (services/path.ts effectiveGoalTrack). */
  goalTrack: TrackId;
}

/** The slice of the Anthropic client this module uses; tests pass a fake. */
export interface MessagesClient {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<Anthropic.Message>;
  };
}

export interface ClaudeService {
  generateTurnLine(input: GenerateTurnInput): Promise<string>;
  judgeAttempt(input: JudgeInput): Promise<JudgeOutput | null>;
  generateBaselineFeedback(input: BaselineFeedbackInput): Promise<BaselineFeedback>;
  proposePath(input: PathGenerationInput): Promise<string[] | null>;
}

// ---------------------------------------------------------------- text shaping

const QUOTE_CHARS = `"'“”‘’«»`;
const SPEAKER_LABEL = /^\s*[A-Z][\w .'-]{0,30}:\s+/;

/** Remove markdown, stage directions, speaker labels and wrapping quotes; collapse whitespace. */
export function cleanSpokenLine(raw: string): string {
  let text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*[^*\n]+\*(?=\s|$)/g, ' ') // *smiles* style stage directions
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[a-z][^)]*)\)/g, ' ') // (pauses), (leans forward)
    .replace(/^\s*(?:#{1,6}|[-*>]|\d+\.)\s+/gm, '')
    .replace(/[*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(SPEAKER_LABEL, '');
  // Strip wrapping quotes repeatedly ("'Hi'" -> Hi), then any stray leading/trailing ones.
  const wrap = new RegExp(`^[${QUOTE_CHARS}]+|[${QUOTE_CHARS}]+$`, 'g');
  text = text.replace(wrap, '').trim();
  return text;
}

/**
 * Enforce the word cap (spec/api.md): keep whole sentences that fit within maxWords;
 * if even the first sentence is too long, hard-cut at maxWords and close it.
 */
export function capWords(text: string, maxWords: number = MAX_GENERATED_WORDS): string {
  const words = text.split(/\s+/).filter((w) => w !== '');
  if (words.length <= maxWords) return words.join(' ');
  const head = words.slice(0, maxWords).join(' ');
  const lastEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (/[.!?]$/.test(head)) return head;
  if (lastEnd > 0) return head.slice(0, lastEnd + 1);
  return `${head.replace(/[,;:\-\s]+$/, '')}.`;
}

/** The spoken line for one turn: cleaned and capped. Empty string when nothing usable is left. */
export function shapeTurnLine(raw: string): string {
  return capWords(cleanSpokenLine(raw));
}

/** Deterministic line when Claude fails twice, so the scenario can always run. */
export function fallbackTurnLine(input: Pick<GenerateTurnInput, 'yourGoal' | 'previousTurns'>): string {
  const line = input.previousTurns.length === 0 ? `Let's begin. ${input.yourGoal}` : 'Thank you. Please go on and tell me more.';
  return capWords(line);
}

// ---------------------------------------------------------------- prompts

const TURN_SYSTEM = `You voice one character in a spoken roleplay that helps someone practise speaking. Your output is read aloud by a text-to-speech engine exactly as written.

Output ONLY the words the character says out loud:
- No stage directions, actions, or tone notes (nothing like "(smiles)" or "*leans in*").
- No markdown, lists, headings, emoji, or speaker labels.
- Do not wrap the line in quotation marks.
- At most ${MAX_GENERATED_WORDS} words. Usually one or two sentences, ending with the question or prompt for the user.
- Stay in character. Never mention that this is practice, an AI, or a roleplay.`;

/** The goal as words for a prompt: the option label, plus the free-text detail when there is one. */
export function goalText(profile: Pick<ProfileInput, 'goal' | 'goalDetail'>): string {
  const label = GOAL_OPTIONS.find((g) => g.id === profile.goal)?.label ?? 'Something else';
  const detail = (profile.goalDetail ?? '').trim();
  return detail === '' ? label : `${label}: ${detail}`;
}

function turnPrompt(input: GenerateTurnInput): string {
  const inputs = Object.entries(input.userInputs)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('\n');
  const history = input.previousTurns
    .map((t) => `Turn ${t.index + 1}\nYou said: ${t.aiText}\nThey answered: ${t.transcript}`)
    .join('\n\n');
  const profile = input.profile ? `Their goal: ${goalText(input.profile)}. Their field: ${input.profile.field}.` : '';
  return [
    `<character>\n${input.persona}\n</character>`,
    `<scene>\n${input.scene}\n</scene>`,
    `<user_goal>\n${input.yourGoal}\n</user_goal>`,
    inputs ? `<user_details>\n${inputs}\n</user_details>` : '',
    profile ? `<user_profile>\n${profile}\n</user_profile>` : '',
    history ? `<conversation_so_far>\n${history}\n</conversation_so_far>` : '',
    `<this_turn>\n${input.generate}\n</this_turn>`,
    'Write the character\'s next spoken line now.',
  ]
    .filter((s) => s !== '')
    .join('\n\n');
}

const JUDGE_SYSTEM = `You judge one attempt in a speaking-practice app against fixed criteria. Be consistent: the same transcript must always get the same rulings.

Rules:
- criteria: one entry per criterion id given, passed true only if the transcript clearly meets it.
- evidence: one or two sentences naming something the speaker did well, quoting or pointing to something they actually said in this transcript. It is shown under the heading "What worked", so it must never be a criticism or a list of what was missing, even when every criterion failed; then pick the most useful thing they did say or attempt. Never generic praise.
- nextAction: exactly one sentence containing exactly one concrete action for the next attempt. No abbreviations such as "e.g." or "i.e.".
- evidence and nextAction are shown to the speaker: address them as "you". Never refer to them in the third person, by name, or by a gendered pronoun.
- fillerRulings: one entry per ambiguous word id given. The word is shown in [brackets] inside its context. isFiller is true when it was used as a verbal filler, false when it carries meaning.
- The objective metrics are context only; do not re-judge pace, fillers, pauses, or duration.`;

/** Neutral label for the AI line, naming the turn's persona when known (not every scenario is an interview). */
function promptLabel(persona: string | undefined): string {
  const p = persona?.trim() ?? '';
  return p === '' ? 'Prompt' : `Prompt (${p})`;
}

function judgePrompt(input: JudgeInput): string {
  const m = input.metrics;
  const metrics = {
    wpm: m.wpm,
    fillersPerMinute: m.fillersPerMinute,
    longestPauseSec: m.longestPauseSec,
    pauseCount2s: m.pauseCount2s,
    durationSec: m.durationSec,
  };
  const transcript = input.turns
    .map((t) => `[Turn ${t.index + 1}]\n${promptLabel(t.persona)}: ${t.aiText}\nSpeaker: ${t.transcript}`)
    .join('\n\n');
  return [
    `<criteria>\n${JSON.stringify(input.criteria.map((c) => ({ id: c.id, criterion: c.criterion })))}\n</criteria>`,
    `<transcript>\n${transcript}\n</transcript>`,
    `<objective_metrics>\n${JSON.stringify(metrics)}\n</objective_metrics>`,
    `<ambiguous_words>\n${JSON.stringify(input.ambiguous.map((a) => ({ id: a.id, word: a.word, context: a.context })))}\n</ambiguous_words>`,
  ].join('\n\n');
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, passed: { type: 'boolean' } },
        required: ['id', 'passed'],
        additionalProperties: false,
      },
    },
    evidence: { type: 'string' },
    nextAction: { type: 'string' },
    fillerRulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, isFiller: { type: 'boolean' } },
        required: ['id', 'isFiller'],
        additionalProperties: false,
      },
    },
  },
  required: ['criteria', 'evidence', 'nextAction', 'fillerRulings'],
  additionalProperties: false,
} as const;

const judgeReplySchema = z.object({
  criteria: z.array(z.object({ id: z.string(), passed: z.boolean() })),
  evidence: z.string(),
  nextAction: z.string(),
  fillerRulings: z.array(z.object({ id: z.number().int(), isFiller: z.boolean() })),
});

const FEEDBACK_SYSTEM = `You are a speaking coach giving someone their first read after a short warm-up recording. Tone: a good sports coach, direct and encouraging, never clinical. No scores, grades, or verdicts. No markdown.

- strength: one short sentence naming one real strength, grounded in the metrics or something they said.
- observation: one short sentence naming the one thing most worth working on, phrased as what to try, not as a flaw.`;

const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: { strength: { type: 'string' }, observation: { type: 'string' } },
  required: ['strength', 'observation'],
  additionalProperties: false,
} as const;

const feedbackReplySchema = z.object({ strength: z.string().min(1), observation: z.string().min(1) });

/** Default thresholds the baseline is read against (spec/scoring.md default rubric). */
export const BASELINE_THRESHOLDS = { fillersPerMinute: 4, paceMin: 120, paceMax: 170, longestPauseSec: 4 } as const;

interface BaselineReading {
  /** Positive: inside the threshold by that fraction of it; negative: past it. */
  margin: number;
  strength: string;
  observation: string;
}

function baselineReadings(metrics: BaselineMetrics): BaselineReading[] {
  const t = BASELINE_THRESHOLDS;
  const fpm = metrics.fillersPerMinute.toFixed(1);
  const wpm = Math.round(metrics.wpm);
  const pause = metrics.longestPauseSec.toFixed(1);
  const paceMid = (t.paceMin + t.paceMax) / 2;
  const paceHalf = (t.paceMax - t.paceMin) / 2;
  return [
    {
      margin: (t.fillersPerMinute - metrics.fillersPerMinute) / t.fillersPerMinute,
      strength: `You kept fillers to ${fpm} per minute, which already makes you sound composed.`,
      observation:
        metrics.fillersPerMinute > t.fillersPerMinute
          ? `At ${fpm} fillers per minute, try pausing silently when you feel one coming.`
          : `At ${fpm} fillers per minute, try pausing silently whenever you need a moment to think.`,
    },
    {
      margin: (paceHalf - Math.abs(metrics.wpm - paceMid)) / paceHalf,
      strength: `Your pace of ${wpm} wpm sat inside the easy-to-follow range of ${t.paceMin}-${t.paceMax}.`,
      observation:
        metrics.wpm > paceMid
          ? `At ${wpm} wpm, try slowing down a touch so each point lands.`
          : `At ${wpm} wpm, try keeping sentences moving a little faster.`,
    },
    {
      margin: (t.longestPauseSec - metrics.longestPauseSec) / t.longestPauseSec,
      strength: `Your longest pause was ${pause}s, so you kept talking without long stalls.`,
      observation: `Your longest pause was ${pause}s; try planning your next point while you finish the current one.`,
    },
  ];
}

/**
 * Deterministic baseline lines from the metrics alone (spec/api.md fallback), read against the default
 * thresholds: strength from the metric with the most margin inside its threshold, observation from the
 * one closest to or furthest past it. Never a verdict.
 */
export function fallbackBaselineFeedback(metrics: BaselineMetrics): BaselineFeedback {
  const byMargin = [...baselineReadings(metrics)].sort((a, b) => b.margin - a.margin);
  const best = byMargin[0];
  const weakest = byMargin[byMargin.length - 1];
  if (!best || !weakest) throw new Error('[claude] no baseline readings');
  const strength = best.margin >= 0 ? best.strength : 'You got a full answer out, which is the hardest part.';
  return { strength, observation: weakest.observation };
}

const PATH_MAX_TOKENS = 16_000;

const PATH_SYSTEM = `You plan a fixed practice path for someone preparing to speak. You pick and order scenarios from a library.

Rules:
- Return between ${PATH_MIN_ITEMS} and ${PATH_MAX_ITEMS} scenario ids, using only ids from the library, each at most once.
- The first id is always "${CALIBRATION_SCENARIO_ID}".
- Order by ascending difficulty; never step up more than 2 difficulty levels between consecutive items.
- At least 60% of the ids come from the goal track named in the request.
- Prefer scenarios that fit their goal and field. Use the baseline metrics and confidence to decide how gently to start.`;

const PATH_SCHEMA = {
  type: 'object',
  properties: { scenarioIds: { type: 'array', items: { type: 'string' } } },
  required: ['scenarioIds'],
  additionalProperties: false,
} as const;

const pathReplySchema = z.object({ scenarioIds: z.array(z.string()) });

function pathPrompt(input: PathGenerationInput): string {
  const p = input.profile;
  const goal = GOAL_OPTIONS.find((g) => g.id === p.goal)?.label ?? 'Something else';
  const profile = {
    goal,
    goalDetail: p.goalDetail ?? '',
    goalTrack: input.goalTrack,
    timeframe: p.timeframe,
    field: p.field,
    confidence: `${p.confidence} of 5`,
  };
  return [
    `<profile>\n${JSON.stringify(profile)}\n</profile>`,
    input.baseline ? `<baseline_metrics>\n${JSON.stringify(input.baseline)}\n</baseline_metrics>` : '',
    `<library>\n${JSON.stringify(input.library)}\n</library>`,
  ]
    .filter((s) => s !== '')
    .join('\n\n');
}

// ---------------------------------------------------------------- calls

function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim();
}

/**
 * Run `attempt` up to twice (spec/api.md: one retry on failure or refusal). `attempt` returns null for a
 * refusal or an unusable reply. Logs only the failure kind, never content.
 */
async function twice<T>(label: string, attempt: () => Promise<T | null>): Promise<T | null> {
  for (let i = 0; i < 2; i += 1) {
    try {
      const result = await attempt();
      if (result !== null) return result;
      console.warn(`[claude] ${label}: unusable reply (try ${i + 1}/2)`);
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? String(error.status) : error instanceof Error ? error.name : 'unknown';
      console.warn(`[claude] ${label}: call failed ${status} (try ${i + 1}/2)`);
    }
  }
  return null;
}

/** Validate the parsed judge reply against what was asked; null when it does not cover every criterion. */
export function normaliseJudgeReply(raw: unknown, input: JudgeInput): JudgeOutput | null {
  const parsed = judgeReplySchema.safeParse(raw);
  if (!parsed.success) return null;
  const reply = parsed.data;
  const wanted = new Set(input.criteria.map((c) => c.id));
  const criteria = reply.criteria.filter((c) => wanted.has(c.id));
  if (new Set(criteria.map((c) => c.id)).size !== wanted.size) return null;
  const knownIds = new Set(input.ambiguous.map((a) => a.id));
  const evidence = reply.evidence.trim();
  const nextAction = firstSentence(reply.nextAction);
  if (evidence === '' || nextAction === '') return null;
  return {
    criteria,
    evidence,
    nextAction,
    fillerRulings: reply.fillerRulings.filter((r) => knownIds.has(r.id)),
  };
}

export function createClaudeService(client: MessagesClient): ClaudeService {
  async function generateTurnLine(input: GenerateTurnInput): Promise<string> {
    const line = await twice('turn', async () => {
      const message = await client.messages.create(
        {
          model: CLAUDE_MODELS.turnGeneration,
          max_tokens: TURN_MAX_TOKENS,
          output_config: { effort: 'low' },
          system: TURN_SYSTEM,
          messages: [{ role: 'user', content: turnPrompt(input) }],
        },
        { timeout: FAST_TIMEOUT_MS },
      );
      if (message.stop_reason === 'refusal') return null;
      const shaped = shapeTurnLine(textOf(message));
      return shaped === '' ? null : shaped;
    });
    return line ?? fallbackTurnLine(input);
  }

  async function judgeAttempt(input: JudgeInput): Promise<JudgeOutput | null> {
    return twice('judge', async () => {
      const message = await client.messages.create(
        {
          model: CLAUDE_MODELS.judge,
          max_tokens: JUDGE_MAX_TOKENS,
          // Adaptive thinking is the default on this model; no temperature (removed, returns 400).
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
          system: JUDGE_SYSTEM,
          messages: [{ role: 'user', content: judgePrompt(input) }],
        },
        { timeout: JUDGE_TIMEOUT_MS },
      );
      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return null;
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(message));
      } catch {
        return null;
      }
      return normaliseJudgeReply(raw, input);
    });
  }

  async function generateBaselineFeedback(input: BaselineFeedbackInput): Promise<BaselineFeedback> {
    const feedback = await twice('baseline', async () => {
      const message = await client.messages.create(
        {
          model: CLAUDE_MODELS.baselineFeedback,
          max_tokens: FEEDBACK_MAX_TOKENS,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: FEEDBACK_SCHEMA } },
          system: FEEDBACK_SYSTEM,
          messages: [
            {
              role: 'user',
              content: `<metrics>\n${JSON.stringify(input.metrics)}\n</metrics>\n\n<transcript>\n${input.transcript}\n</transcript>`,
            },
          ],
        },
        { timeout: FAST_TIMEOUT_MS },
      );
      if (message.stop_reason === 'refusal') return null;
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(message));
      } catch {
        return null;
      }
      const parsed = feedbackReplySchema.safeParse(raw);
      if (!parsed.success) return null;
      return { strength: firstSentence(parsed.data.strength), observation: firstSentence(parsed.data.observation) };
    });
    return feedback ?? fallbackBaselineFeedback(input.metrics);
  }

  async function proposePath(input: PathGenerationInput): Promise<string[] | null> {
    return twice('path', async () => {
      const message = await client.messages.create(
        {
          model: CLAUDE_MODELS.pathGeneration,
          max_tokens: PATH_MAX_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: PATH_SCHEMA } },
          system: PATH_SYSTEM,
          messages: [{ role: 'user', content: pathPrompt(input) }],
        },
        { timeout: JUDGE_TIMEOUT_MS },
      );
      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return null;
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(message));
      } catch {
        return null;
      }
      const parsed = pathReplySchema.safeParse(raw);
      return parsed.success && parsed.data.scenarioIds.length > 0 ? parsed.data.scenarioIds : null;
    });
  }

  return { generateTurnLine, judgeAttempt, generateBaselineFeedback, proposePath };
}

let defaultService: ClaudeService | null = null;

function service(): ClaudeService {
  if (defaultService === null) {
    // One retry is handled here (spec/api.md), so the SDK's own retries are off.
    defaultService = createClaudeService(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 }));
  }
  return defaultService;
}

/** Generate the AI line for one turn: cleaned, capped at MAX_GENERATED_WORDS. Never rejects (falls back to a neutral line). */
export async function generateTurnLine(input: GenerateTurnInput): Promise<string> {
  return service().generateTurnLine(input);
}

/** Run the judge with one retry. Resolves null when both tries fail; the caller then uses judge: null. Never rejects. */
export async function judgeAttempt(input: JudgeInput): Promise<JudgeOutput | null> {
  return service().judgeAttempt(input);
}

/** Two short coaching lines for the baseline. Never rejects (falls back to metric-derived lines). */
export async function generateBaselineFeedback(input: BaselineFeedbackInput): Promise<BaselineFeedback> {
  return service().generateBaselineFeedback(input);
}

/**
 * Raw proposed scenario ids, or null when both tries fail. Validation and repair happen in
 * services/path.ts. Never rejects.
 */
export async function proposePath(input: PathGenerationInput): Promise<string[] | null> {
  return service().proposePath(input);
}
