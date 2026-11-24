import { z } from 'zod';

/**
 * Scenario template schema — spec/scenario-schema.md.
 * The template is fixed; only the spoken lines are generated at runtime.
 * Unknown keys are stripped (zod default), so content may carry editorial notes.
 */

export const TRACK_IDS = ['fundamentals', 'professional', 'academic', 'social', 'stage'] as const;
export const trackIdSchema = z.enum(TRACK_IDS);
export type TrackId = z.infer<typeof trackIdSchema>;

export const TRACK_LABELS: Readonly<Record<TrackId, string>> = {
  fundamentals: 'Fundamentals',
  professional: 'Professional',
  academic: 'Academic',
  social: 'Social',
  stage: 'Stage',
};

const inputKeySchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'userInputs key must be an identifier usable as {{key}}');

const baseInput = {
  key: inputKeySchema,
  label: z.string().min(1),
  placeholder: z.string().optional(),
  required: z.boolean().default(true),
};

export const selectOptionSchema = z.union([
  z.string().min(1),
  z.object({ value: z.string().min(1), label: z.string().min(1) }),
]);
export type SelectOption = z.infer<typeof selectOptionSchema>;

export const userInputSchema = z.discriminatedUnion('type', [
  z.object({ ...baseInput, type: z.literal('text'), maxLength: z.number().int().positive().optional() }),
  z.object({ ...baseInput, type: z.literal('textarea'), maxLength: z.number().int().positive().optional() }),
  z.object({ ...baseInput, type: z.literal('select'), options: z.array(selectOptionSchema).min(1) }),
]);
export type UserInputField = z.infer<typeof userInputSchema>;
export type UserInputType = UserInputField['type'];

export const userResponseSchema = z
  .object({
    maxSeconds: z.number().positive(),
    minSeconds: z.number().nonnegative(),
    silenceStopSeconds: z.number().positive(),
    /** Optional: show the countdown as a design element (e.g. "Summarise under time pressure"). */
    countdown: z.boolean().optional(),
  })
  .refine((r) => r.minSeconds <= r.maxSeconds, { message: 'minSeconds must be <= maxSeconds' });
export type UserResponseLimits = z.infer<typeof userResponseSchema>;

export const turnSchema = z.object({
  index: z.number().int().nonnegative(),
  speaker: z.literal('ai'),
  persona: z.string().min(1),
  generate: z.string().min(1),
  dependsOnPreviousAnswer: z.boolean().default(false),
  userResponse: userResponseSchema,
});
export type ScenarioTurn = z.infer<typeof turnSchema>;

export const OBJECTIVE_METRICS = [
  'fillersPerMinute',
  'wpm',
  'longestPauseSec',
  'durationSec',
  'pauseCount2s',
] as const;
export const objectiveMetricSchema = z.enum(OBJECTIVE_METRICS);
export type ObjectiveMetric = z.infer<typeof objectiveMetricSchema>;

const objectiveBase = {
  id: z.string().min(1),
  label: z.string().min(1),
  metric: objectiveMetricSchema,
};

export const objectiveCriterionSchema = z.discriminatedUnion('op', [
  z.object({ ...objectiveBase, op: z.literal('lte'), value: z.number() }),
  z.object({ ...objectiveBase, op: z.literal('gte'), value: z.number() }),
  z.object({
    ...objectiveBase,
    op: z.literal('between'),
    value: z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo <= hi, {
      message: 'between value must be [low, high] with low <= high',
    }),
  }),
]);
export type ObjectiveCriterion = z.infer<typeof objectiveCriterionSchema>;
export type ObjectiveOp = ObjectiveCriterion['op'];

export const judgedCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  criterion: z.string().min(1),
});
export type JudgedCriterion = z.infer<typeof judgedCriterionSchema>;

export const rubricSchema = z
  .object({
    objective: z.array(objectiveCriterionSchema).min(1),
    judged: z.array(judgedCriterionSchema).min(1),
  })
  .refine(
    (r) => {
      const ids = [...r.objective, ...r.judged].map((c) => c.id);
      return new Set(ids).size === ids.length;
    },
    { message: 'rubric criterion ids must be unique' },
  );
export type Rubric = z.infer<typeof rubricSchema>;

export const scenarioSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
    track: trackIdSchema,
    title: z.string().min(1),
    /** One sentence. Used by the library and by path generation. Expected on every scenario. */
    description: z.string().min(1).optional(),
    difficulty: z.number().int().min(1).max(5),
    userInputs: z.array(userInputSchema).default([]),
    brief: z.object({
      scene: z.string().min(1),
      yourGoal: z.string().min(1),
    }),
    turns: z.array(turnSchema).min(1).max(4),
    rubric: rubricSchema,
    criteriaDisplay: z.array(z.string().min(1)).min(1),
  })
  .superRefine((s, ctx) => {
    s.turns.forEach((t, i) => {
      if (t.index !== i) {
        ctx.addIssue({ code: 'custom', path: ['turns', i, 'index'], message: `turn index must be ${i}` });
      }
    });
    if (s.turns[0]?.dependsOnPreviousAnswer) {
      ctx.addIssue({
        code: 'custom',
        path: ['turns', 0, 'dependsOnPreviousAnswer'],
        message: 'first turn has no previous answer',
      });
    }
    const keys = s.userInputs.map((u) => u.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['userInputs'], message: 'userInputs keys must be unique' });
    }
  });

/** Parsed scenario (defaults applied). */
export type Scenario = z.infer<typeof scenarioSchema>;
/** Raw JSON shape before defaults. */
export type ScenarioInput = z.input<typeof scenarioSchema>;

/** Values the user typed on the setup screen, keyed by userInputs[].key. */
export type UserInputValues = Readonly<Record<string, string>>;

export function selectOptionValue(option: SelectOption): string {
  return typeof option === 'string' ? option : option.value;
}

export function selectOptionLabel(option: SelectOption): string {
  return typeof option === 'string' ? option : option.label;
}

/** Replace {{key}} placeholders. Unknown or empty keys are left as-is so a gap is visible, not silently blank. */
export function interpolate(template: string, values: UserInputValues): string {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const v = values[key];
    return v === undefined || v === '' ? match : v;
  });
}

/** Validate setup values against a scenario's userInputs. Returns error messages keyed by input key; empty = valid. */
export function validateUserInputs(
  fields: readonly UserInputField[],
  values: UserInputValues,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') {
      if (field.required) errors[field.key] = field.type === 'select' ? 'Choose one to continue.' : 'Add an answer to continue.';
      continue;
    }
    if (field.type === 'select') {
      if (!field.options.map(selectOptionValue).includes(value)) {
        errors[field.key] = 'Choose one of the listed options';
      }
    } else if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors[field.key] = `Keep it under ${field.maxLength} characters`;
    }
  }
  return errors;
}

/** Total expected answer time in seconds (sum of turn maxSeconds), for the brief screen. */
export function expectedDurationSec(scenario: Pick<Scenario, 'turns'>): number {
  return scenario.turns.reduce((sum, t) => sum + t.userResponse.maxSeconds, 0);
}

/** One-line summary for library and path generation; falls back to the brief goal. */
export function scenarioDescription(scenario: Pick<Scenario, 'description' | 'brief'>): string {
  return scenario.description ?? scenario.brief.yourGoal;
}
