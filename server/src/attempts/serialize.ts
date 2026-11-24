import {
  expectedDurationSec,
  scenarioDescription,
  type Attempt,
  type ProgressStatus,
  type PublicScenario,
  type Scenario,
  type ScenarioRef,
  type ScenarioSummary,
} from '@rehearsal/shared';
import type { AttemptDoc } from '../models/Attempt';

/** Mongo documents -> wire DTOs. Ids become hex strings, dates ISO strings. */

export function toAttemptDto(doc: AttemptDoc): Attempt {
  return {
    id: doc._id.toHexString(),
    scenarioId: doc.scenarioId,
    userInputs: { ...doc.userInputs },
    status: doc.status,
    startedAt: doc.startedAt.toISOString(),
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    turns: [...doc.turns]
      .sort((a, b) => a.index - b.index)
      .map((t) => ({
        index: t.index,
        aiText: t.aiText,
        audioId: t.audioId ? t.audioId.toHexString() : null,
        transcript: t.transcript,
        words: t.words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
        ...(t.audioDurationSec !== undefined && t.audioDurationSec !== null ? { audioDurationSec: t.audioDurationSec } : {}),
      })),
    metrics: doc.metrics ?? null,
    verdict: doc.verdict ?? null,
  };
}

export function toScenarioRef(scenario: Scenario): ScenarioRef {
  return {
    id: scenario.id,
    title: scenario.title,
    track: scenario.track,
    rubric: scenario.rubric,
    criteriaDisplay: [...scenario.criteriaDisplay],
  };
}

/** The template without generation prompts: those stay server-side. */
export function toPublicScenario(scenario: Scenario): PublicScenario {
  return {
    ...scenario,
    description: scenarioDescription(scenario),
    turns: scenario.turns.map(({ generate: _generate, ...rest }) => rest),
  };
}

export interface UserScenarioState {
  onPath: boolean;
  state: ProgressStatus | null;
  attemptCount: number;
}

export function toScenarioSummary(scenario: Scenario, user: UserScenarioState): ScenarioSummary {
  return {
    id: scenario.id,
    track: scenario.track,
    title: scenario.title,
    description: scenarioDescription(scenario),
    difficulty: scenario.difficulty,
    turnCount: scenario.turns.length,
    expectedDurationSec: expectedDurationSec(scenario),
    hasSetup: scenario.userInputs.length > 0,
    onPath: user.onPath,
    state: user.state,
    attemptCount: user.attemptCount,
  };
}
