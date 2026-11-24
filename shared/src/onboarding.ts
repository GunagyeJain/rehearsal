import { z } from 'zod';
import type { TrackId } from './scenario';

/** Onboarding option lists (spec/screens.md section 2) and the goal-to-track mapping used by path generation. */

export interface GoalOption {
  id: string;
  label: string;
  /** Track that must make up at least 60% of the path for this goal. */
  track: TrackId;
}

export const GOAL_OPTIONS: readonly GoalOption[] = [
  { id: 'job-interview', label: 'A job or internship interview', track: 'professional' },
  { id: 'workplace', label: 'Speaking up at work: standups, updates, feedback', track: 'professional' },
  { id: 'viva', label: 'A viva, oral exam or project defence', track: 'academic' },
  { id: 'presentation', label: 'A presentation, pitch or talk', track: 'stage' },
  { id: 'social', label: 'Conversations and networking', track: 'social' },
  { id: 'general', label: 'General confidence speaking', track: 'fundamentals' },
];

/** "Something else" free-text goal. Falls back to the Fundamentals track. */
export const OTHER_GOAL_ID = 'other';

export const TIMEFRAME_OPTIONS = [
  { id: 'this-month', label: 'This month' },
  { id: 'this-term', label: 'This term' },
  { id: 'no-fixed-date', label: 'No fixed date' },
] as const;

export type TimeframeId = (typeof TIMEFRAME_OPTIONS)[number]['id'];

export const CONFIDENCE_LABELS = { low: 'Not at all confident', high: 'Very confident' } as const;

export function trackForGoal(goalId: string): TrackId {
  return GOAL_OPTIONS.find((g) => g.id === goalId)?.track ?? 'fundamentals';
}

const goalIds: [string, ...string[]] = [OTHER_GOAL_ID, ...GOAL_OPTIONS.map((g) => g.id)];

/** The profile fields without the cross-field rule, so PATCH can take a partial of them. */
export const profileFieldsSchema = z.object({
  goal: z.enum(goalIds),
  goalDetail: z.string().trim().max(300).default(''),
  timeframe: z.enum(TIMEFRAME_OPTIONS.map((t) => t.id) as [TimeframeId, ...TimeframeId[]]),
  field: z.string().trim().min(1).max(120),
  confidence: z.number().int().min(1).max(5),
});

export const profileInputSchema = profileFieldsSchema
  .refine((p) => p.goal !== OTHER_GOAL_ID || p.goalDetail.length > 0, {
    message: 'Describe what you are preparing for',
    path: ['goalDetail'],
  });

export type ProfileInput = z.input<typeof profileInputSchema>;

/**
 * PATCH /api/users/me/profile body: any subset of the fields, strict. zod cannot `.partial()` a refined
 * schema, so the server merges the patch into the stored profile and re-validates with profileInputSchema.
 */
export const profilePatchSchema = profileFieldsSchema
  .extend({ goalDetail: z.string().trim().max(300) })
  .partial()
  .strict();
