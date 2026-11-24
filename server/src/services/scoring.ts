import {
  applyFillerRulings,
  buildVerdict,
  computeAttemptMetrics,
  evaluateObjective,
  type ProvisionalReport,
  type Scenario,
  type Verdict,
  type Word,
} from '@rehearsal/shared';
import { judgeAttempt, type JudgeInput, type JudgeOutput } from './claude';

export interface ScoringTurn {
  index: number;
  aiText: string;
  transcript: string;
  words: readonly Word[];
}

export interface FirstPass {
  provisional: ProvisionalReport;
  /** What the judge needs, built from the first pass. */
  judgeInput: JudgeInput;
}

export interface FinalScore {
  verdict: Verdict;
  metrics: ProvisionalReport['metrics'];
}

export interface ScoredAttempt extends FinalScore {
  /** The first-pass report, so a caller can show objective results before the judge returns. */
  provisional: ProvisionalReport;
}

export type JudgeFn = (input: JudgeInput) => Promise<JudgeOutput | null>;

/**
 * Synchronous first pass at finalize: objective metrics and criteria, ambiguous fillers pending.
 * Throws ScoringInputError when any turn lacks usable timestamps (never estimated).
 */
export function scoreFirstPass(scenario: Scenario, turns: readonly ScoringTurn[]): FirstPass {
  const analysis = computeAttemptMetrics(turns.map((t) => t.words));
  const provisional: ProvisionalReport = {
    metrics: analysis.metrics,
    objective: evaluateObjective(scenario.rubric.objective, analysis.metrics),
    ambiguous: analysis.ambiguous.map((a) => ({ id: a.id, word: a.word, turnIndex: a.turnIndex, wordIndex: a.wordIndex })),
  };
  const judgeInput: JudgeInput = {
    criteria: scenario.rubric.judged,
    turns: turns.map((t) => ({
      index: t.index,
      aiText: t.aiText,
      transcript: t.transcript,
      persona: scenario.turns[t.index]?.persona,
    })),
    metrics: analysis.metrics,
    ambiguous: analysis.ambiguous.map((a) => ({ id: a.id, word: a.word, context: a.context })),
  };
  return { provisional, judgeInput };
}

/** Combine the first pass with the judge result (null when the judge was unavailable). */
export function scoreFinal(
  scenario: Scenario,
  turnWords: readonly (readonly Word[])[],
  judge: JudgeOutput | null,
): FinalScore {
  const firstPass = computeAttemptMetrics(turnWords);
  if (judge === null) {
    return {
      metrics: firstPass.metrics,
      verdict: buildVerdict({ rubric: scenario.rubric, metrics: firstPass.metrics, judge: null }),
    };
  }
  const metrics = applyFillerRulings(turnWords, firstPass, judge.fillerRulings);
  const verdict = buildVerdict({
    rubric: scenario.rubric,
    metrics,
    judge: { outcomes: judge.criteria, evidence: judge.evidence, nextAction: judge.nextAction },
  });
  return { metrics, verdict };
}

/**
 * The whole pipeline: computeAttemptMetrics -> judge -> applyFillerRulings -> buildVerdict.
 * Routes that answer early should call scoreFirstPass, respond, then run the judge and scoreFinal;
 * this helper is for the background job and tests. Never rejects because of the judge.
 */
export async function scoreAttempt(
  input: { scenario: Scenario; turns: readonly ScoringTurn[] },
  judge: JudgeFn = judgeAttempt,
): Promise<ScoredAttempt> {
  const { provisional, judgeInput } = scoreFirstPass(input.scenario, input.turns);
  let judgeResult: JudgeOutput | null;
  try {
    judgeResult = await judge(judgeInput);
  } catch {
    judgeResult = null; // the judge contract is never-reject; this guards an injected one
  }
  const final = scoreFinal(
    input.scenario,
    input.turns.map((t) => t.words),
    judgeResult,
  );
  return { ...final, provisional };
}
