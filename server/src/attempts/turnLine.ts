import { interpolate, type Scenario, type UserInputValues, type UserProfile } from '@rehearsal/shared';
import { capWords, generateTurnLine, type TranscriptTurn } from '../services/claude';
import type { AttemptTurnDoc } from '../models/Attempt';

/** Neutral line for later turns when generation fails. Capped like any generated line (spec/scenario-schema.md). */
const FOLLOW_UP_FALLBACK = 'Thank you. Could you tell me a little more about that?';

export function fallbackLine(scenario: Scenario, turnIndex: number, userInputs: UserInputValues): string {
  if (turnIndex === 0) return capWords(`Let's begin. ${interpolate(scenario.brief.yourGoal, userInputs)}`);
  return capWords(FOLLOW_UP_FALLBACK);
}

export interface TurnLineContext {
  scenario: Scenario;
  turnIndex: number;
  userInputs: UserInputValues;
  profile: UserProfile | null;
  /** Turns of this attempt before turnIndex. */
  previousTurns: readonly AttemptTurnDoc[];
}

/**
 * Generate the line for one turn. The service cleans, caps at MAX_GENERATED_WORDS, retries and
 * falls back itself; this guard only covers an unexpected rejection or an empty line, so the
 * scenario can always run.
 */
export async function produceTurnLine(ctx: TurnLineContext): Promise<string> {
  const turn = ctx.scenario.turns[ctx.turnIndex];
  if (!turn) throw new Error(`[attempts] turn ${ctx.turnIndex} is not in scenario ${ctx.scenario.id}`);
  const previousTurns: TranscriptTurn[] = ctx.previousTurns
    .filter((t) => t.index < ctx.turnIndex)
    .map((t) => ({ index: t.index, aiText: t.aiText, transcript: t.transcript }));
  try {
    const raw = await generateTurnLine({
      generate: turn.generate,
      persona: turn.persona,
      scene: interpolate(ctx.scenario.brief.scene, ctx.userInputs),
      yourGoal: interpolate(ctx.scenario.brief.yourGoal, ctx.userInputs),
      userInputs: ctx.userInputs,
      profile: ctx.profile ? { goal: ctx.profile.goal, goalDetail: ctx.profile.goalDetail, field: ctx.profile.field } : null,
      previousTurns,
    });
    const line = raw.trim();
    return line === '' ? fallbackLine(ctx.scenario, ctx.turnIndex, ctx.userInputs) : line;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.name : 'unknown error';
    console.warn(`[attempts] turn generation failed (${reason}); using fallback line`);
    return fallbackLine(ctx.scenario, ctx.turnIndex, ctx.userInputs);
  }
}
