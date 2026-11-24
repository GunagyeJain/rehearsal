import {
  TREND_METRICS,
  type AttemptHistoryEntry,
  type AttemptHistoryGroup,
  type Metrics,
  type Scenario,
  type TrendMetric,
  type Verdict,
} from '@rehearsal/shared';

/** The fields of a scored attempt that history needs. Transcripts and words are never read here. */
export interface HistoryAttemptInput {
  id: string;
  scenarioId: string;
  startedAt: Date;
  completedAt: Date | null;
  metrics: Pick<Metrics, TrendMetric> | null;
  verdict: Pick<Verdict, 'passed' | 'passedCount' | 'totalCount' | 'judgeUnavailable'> | null;
}

type ScenarioLookup = (id: string) => Pick<Scenario, 'id' | 'title' | 'track' | 'rubric'> | undefined;

function isTrendMetric(metric: string): metric is TrendMetric {
  return (TREND_METRICS as readonly string[]).includes(metric);
}

function targetsFor(scenario: Pick<Scenario, 'rubric'>): AttemptHistoryGroup['targets'] {
  const targets: AttemptHistoryGroup['targets'] = {};
  for (const criterion of scenario.rubric.objective) {
    if (isTrendMetric(criterion.metric)) targets[criterion.metric] = { op: criterion.op, value: criterion.value };
  }
  return targets;
}

function toEntry(attempt: HistoryAttemptInput): AttemptHistoryEntry | null {
  if (!attempt.metrics || !attempt.verdict) return null;
  const metrics = Object.fromEntries(TREND_METRICS.map((m) => [m, attempt.metrics?.[m] ?? 0])) as Pick<
    Metrics,
    TrendMetric
  >;
  return {
    id: attempt.id,
    startedAt: attempt.startedAt.toISOString(),
    completedAt: (attempt.completedAt ?? attempt.startedAt).toISOString(),
    passed: attempt.verdict.passed,
    passedCount: attempt.verdict.passedCount,
    totalCount: attempt.verdict.totalCount,
    judgeUnavailable: attempt.verdict.judgeUnavailable,
    metrics,
  };
}

function emptyTrend(): Record<TrendMetric, number[]> {
  return Object.fromEntries(TREND_METRICS.map((m) => [m, [] as number[]])) as Record<TrendMetric, number[]>;
}

/**
 * Group scored attempts by scenario: attempts newest first, trend arrays oldest to newest, groups
 * ordered by their most recent attempt. Attempts for scenarios no longer loaded are left out.
 */
export function buildHistoryGroups(attempts: readonly HistoryAttemptInput[], lookup: ScenarioLookup): AttemptHistoryGroup[] {
  const byScenario = new Map<string, AttemptHistoryEntry[]>();
  for (const attempt of attempts) {
    const entry = toEntry(attempt);
    if (!entry || !lookup(attempt.scenarioId)) continue;
    byScenario.set(attempt.scenarioId, [...(byScenario.get(attempt.scenarioId) ?? []), entry]);
  }

  const groups: AttemptHistoryGroup[] = [];
  for (const [scenarioId, entries] of byScenario) {
    const scenario = lookup(scenarioId);
    if (!scenario) continue;
    const newestFirst = [...entries].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const trend = emptyTrend();
    for (const entry of [...newestFirst].reverse()) {
      for (const metric of TREND_METRICS) trend[metric] = [...trend[metric], entry.metrics[metric]];
    }
    groups.push({
      scenario: { id: scenario.id, title: scenario.title, track: scenario.track },
      attempts: newestFirst,
      trend,
      targets: targetsFor(scenario),
    });
  }
  return groups.sort((a, b) => (b.attempts[0]?.completedAt ?? '').localeCompare(a.attempts[0]?.completedAt ?? ''));
}
