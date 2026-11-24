import type { CriterionResult, MetricValues, PaceWindow, Verdict } from './domain';
import { ScoringInputError } from './errors';
import type { JudgedCriterion, ObjectiveCriterion, ObjectiveMetric, Rubric } from './scenario';

/** Rubric evaluation and the pass rule — spec/scoring.md. */

const METRIC_UNITS: Readonly<Record<ObjectiveMetric, string>> = {
  fillersPerMinute: 'per minute',
  wpm: 'wpm',
  longestPauseSec: 's',
  durationSec: 's',
  pauseCount2s: 'long pauses',
};

const METRIC_DECIMALS: Readonly<Record<ObjectiveMetric, number>> = {
  fillersPerMinute: 1,
  wpm: 0,
  longestPauseSec: 1,
  durationSec: 0,
  pauseCount2s: 0,
};

/** Format a metric value with its unit, e.g. "184 wpm", "3.2 s", "1.5 per minute". */
export function formatMetricValue(metric: ObjectiveMetric, value: number): string {
  const unit = METRIC_UNITS[metric];
  const n = value.toFixed(METRIC_DECIMALS[metric]);
  return unit === 's' ? `${n}s` : `${n} ${unit}`;
}

/** Human-readable target, e.g. "120-170 wpm", "at most 4 per minute". */
export function formatTarget(criterion: ObjectiveCriterion): string {
  const unit = METRIC_UNITS[criterion.metric];
  const suffix = unit === 's' ? 's' : ` ${unit}`;
  switch (criterion.op) {
    case 'lte':
      return `at most ${criterion.value}${suffix}`;
    case 'gte':
      return `at least ${criterion.value}${suffix}`;
    case 'between':
      return `${criterion.value[0]}-${criterion.value[1]}${suffix}`;
  }
}

export function meetsCriterion(criterion: ObjectiveCriterion, actual: number): boolean {
  switch (criterion.op) {
    case 'lte':
      return actual <= criterion.value;
    case 'gte':
      return actual >= criterion.value;
    case 'between':
      return actual >= criterion.value[0] && actual <= criterion.value[1];
  }
}

/** Evaluate every objective criterion against computed metrics. Throws if a metric is missing. */
export function evaluateObjective(
  criteria: readonly ObjectiveCriterion[],
  metrics: MetricValues,
): CriterionResult[] {
  return criteria.map((c) => {
    const actual = metrics[c.metric];
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      throw new ScoringInputError('UNKNOWN_METRIC', `Metric "${c.metric}" is missing for criterion "${c.id}".`);
    }
    const target = formatTarget(c);
    return {
      id: c.id,
      label: c.label,
      kind: 'objective',
      passed: meetsCriterion(c, actual),
      detail: `${formatMetricValue(c.metric, actual)}, target ${target}`,
      metric: c.metric,
      actual,
      target,
    };
  });
}

export interface PassResult {
  passedCount: number;
  totalCount: number;
  passed: boolean;
}

/** Pass when at most one criterion fails. Never scaled to percentages. */
export function passRule(criteria: readonly Pick<CriterionResult, 'passed'>[]): PassResult {
  if (criteria.length === 0) {
    throw new ScoringInputError('EMPTY_CRITERIA', 'Cannot apply the pass rule to zero criteria.');
  }
  const passedCount = criteria.filter((c) => c.passed).length;
  return { passedCount, totalCount: criteria.length, passed: criteria.length - passedCount <= 1 };
}

/** The judge's ruling on one judged criterion. */
export interface JudgedOutcome {
  id: string;
  passed: boolean;
}

export const JUDGE_UNAVAILABLE_DETAIL = 'The structure check could not run this time, so it was not counted against you.';

/** Judged criteria results. When the judge is unavailable they auto-pass (spec/scoring.md: never fail a user for an API error). */
export function evaluateJudged(
  criteria: readonly JudgedCriterion[],
  outcomes: readonly JudgedOutcome[] | null,
  evidence: string,
): CriterionResult[] {
  return criteria.map((c) => {
    if (outcomes === null) {
      return { id: c.id, label: c.label, kind: 'judged', passed: true, detail: JUDGE_UNAVAILABLE_DETAIL };
    }
    const outcome = outcomes.find((o) => o.id === c.id);
    return {
      id: c.id,
      label: c.label,
      kind: 'judged',
      passed: outcome?.passed ?? true,
      detail: evidence,
    };
  });
}

/** Take the first sentence only: nextAction is one sentence, one action. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  // A terminator, plus any closing quotes/brackets, followed by whitespace or the end.
  const terminator = /[.!?]["'”’)\]]*(?=\s|$)/g;
  for (const match of trimmed.matchAll(terminator)) {
    const end = match.index + match[0].length;
    if (match[0].startsWith('.') && endsWithAbbreviation(trimmed.slice(0, match.index + 1))) continue;
    return trimmed.slice(0, end).trim();
  }
  return trimmed;
}

/** Abbreviations whose period does not end a sentence ("e.g.", "Dr.", ...). */
const NON_TERMINAL_ABBREVIATIONS = new Set(['e.g.', 'i.e.', 'etc.', 'vs.', 'cf.', 'approx.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.']);

function endsWithAbbreviation(textThroughPeriod: string): boolean {
  const lastToken = textThroughPeriod.split(/[\s("'“]+/).pop()?.toLowerCase() ?? '';
  return NON_TERMINAL_ABBREVIATIONS.has(lastToken);
}

export interface BuildVerdictInput {
  rubric: Rubric;
  metrics: MetricValues;
  /** null when the judge failed after its retry. */
  judge: { outcomes: JudgedOutcome[]; evidence: string; nextAction: string } | null;
  /** Used when the judge is unavailable: an action derived from the first failing objective criterion. */
  fallbackNextAction?: string;
}

/** Assemble the full verdict: objective results, judged results, pass rule. */
export function buildVerdict(input: BuildVerdictInput): Verdict {
  const objective = evaluateObjective(input.rubric.objective, input.metrics);
  const judged = evaluateJudged(
    input.rubric.judged,
    input.judge ? input.judge.outcomes : null,
    input.judge ? input.judge.evidence : '',
  );
  const criteria = [...objective, ...judged];
  const result = passRule(criteria);
  return {
    criteria,
    ...result,
    evidence: input.judge ? input.judge.evidence : defaultEvidence(input.rubric.objective, input.metrics),
    nextAction: input.judge ? firstSentence(input.judge.nextAction) : (input.fallbackNextAction ?? defaultNextAction(input.rubric.objective, input.metrics)),
    judgeUnavailable: input.judge === null,
  };
}

const METRIC_ADVICE: Readonly<Record<ObjectiveMetric, { low: string; high: string }>> = {
  fillersPerMinute: { low: 'Keep going as you are.', high: 'When you feel a filler coming, pause silently instead.' },
  wpm: { low: 'Pick up the pace slightly and keep sentences moving.', high: 'Slow down and let each sentence land before the next.' },
  longestPauseSec: { low: 'Keep going as you are.', high: 'Plan your next point while finishing the current one so pauses stay short.' },
  durationSec: { low: 'Add one more concrete detail to fill the time.', high: 'Cut to your strongest two points so you finish inside the time.' },
  pauseCount2s: { low: 'Keep going as you are.', high: 'Bridge between points with a short linking phrase instead of a long silence.' },
};

const METRIC_STRENGTH_SUBJECT: Readonly<Record<ObjectiveMetric, string>> = {
  fillersPerMinute: 'You kept fillers to',
  wpm: 'Your pace held at',
  longestPauseSec: 'Your longest pause was',
  durationSec: 'Your answer ran',
  pauseCount2s: 'You had',
};

/** Strength line when no objective criterion passed: every attempt that is scored finished all its turns. */
export const DEFAULT_EVIDENCE_NO_PASS = 'You saw every question through to the end, which is the hardest part.';

/** How far inside its target a value sits, as a fraction of the target (negative: outside). */
function criterionMargin(criterion: ObjectiveCriterion, actual: number): number {
  switch (criterion.op) {
    case 'lte':
      return criterion.value === 0 ? (actual <= 0 ? 1 : -1) : (criterion.value - actual) / criterion.value;
    case 'gte':
      return criterion.value === 0 ? 1 : (actual - criterion.value) / criterion.value;
    case 'between': {
      const [low, high] = criterion.value;
      const half = (high - low) / 2;
      return half === 0 ? (actual === low ? 1 : -1) : (half - Math.abs(actual - (low + high) / 2)) / half;
    }
  }
}

/**
 * Deterministic strength line for when the judge is unavailable (the report always leads with a
 * strength): names the passing objective criterion with the most margin inside its target.
 */
export function defaultEvidence(criteria: readonly ObjectiveCriterion[], metrics: MetricValues): string {
  let best: { criterion: ObjectiveCriterion; margin: number } | null = null;
  for (const criterion of criteria) {
    const actual = metrics[criterion.metric];
    if (!meetsCriterion(criterion, actual)) continue;
    const margin = criterionMargin(criterion, actual);
    if (best === null || margin > best.margin) best = { criterion, margin };
  }
  if (best === null) return DEFAULT_EVIDENCE_NO_PASS;
  const { criterion } = best;
  const value = formatMetricValue(criterion.metric, metrics[criterion.metric]);
  const target = formatTarget(criterion);
  const where = criterion.op === 'between' ? `inside the ${target} target` : `within the target of ${target}`;
  return `${METRIC_STRENGTH_SUBJECT[criterion.metric]} ${value}, ${where}.`;
}

/** Deterministic one-sentence action from the first failing objective criterion. */
export function defaultNextAction(criteria: readonly ObjectiveCriterion[], metrics: MetricValues): string {
  const failing = criteria.find((c) => !meetsCriterion(c, metrics[c.metric]));
  if (!failing) return 'Run it again and aim to repeat what worked.';
  const advice = METRIC_ADVICE[failing.metric];
  const actual = metrics[failing.metric];
  const tooLow = failing.op === 'gte' || (failing.op === 'between' && actual < failing.value[0]);
  return tooLow ? advice.low : advice.high;
}

export interface PaceDriftRange {
  turnIndex: number;
  start: number;
  end: number;
  direction: 'slow' | 'fast';
}

/**
 * Merge consecutive out-of-range pace windows into ranges for the report's pace band.
 * Partial tail windows shorter than minSpanSec are ignored (too short to be meaningful).
 */
export function paceDriftRanges(
  windows: readonly PaceWindow[],
  range: readonly [number, number],
  minSpanSec = 4,
): PaceDriftRange[] {
  const out: PaceDriftRange[] = [];
  for (const w of windows) {
    if (w.end - w.start < minSpanSec) continue;
    const direction = w.wpm < range[0] ? 'slow' : w.wpm > range[1] ? 'fast' : null;
    if (direction === null) continue;
    const prev = out[out.length - 1];
    if (prev && prev.turnIndex === w.turnIndex && prev.direction === direction && Math.abs(prev.end - w.start) < 0.01) {
      out[out.length - 1] = { ...prev, end: w.end };
    } else {
      out.push({ turnIndex: w.turnIndex, start: w.start, end: w.end, direction });
    }
  }
  return out;
}
