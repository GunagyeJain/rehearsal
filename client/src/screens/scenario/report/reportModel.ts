import {
  formatMetricValue,
  paceDriftRanges,
  type AttemptDetailResponse,
  type CriterionResult,
  type FillerMark,
  type Metrics,
  type PaceDriftRange,
  type PauseMark,
  type Rubric,
  type Word,
} from '@rehearsal/shared';

/** Pure view-model for the report screen: no React, so it is unit-tested directly. */

export type CriterionState = 'met' | 'not-met' | 'pending';

export interface CriterionRow {
  id: string;
  label: string;
  kind: CriterionResult['kind'];
  state: CriterionState;
  /** "184 wpm, target 120-170 wpm" for objective rows; evidence or a note for judged rows. */
  detail: string;
  /** Provisional fillers row while ambiguous words still await a ruling. */
  mayChange: boolean;
}

export type VerdictState = 'passed' | 'not-yet' | 'pending';

export interface TurnView {
  index: number;
  aiText: string;
  words: readonly Word[];
  audioId: string | null;
  durationSec: number;
  fillerMarks: FillerMark[];
  pauseMarks: PauseMark[];
  paceDrift: PaceDriftRange[];
}

export interface ReportModel {
  verdict: VerdictState;
  passedCount: number | null;
  totalCount: number;
  evidence: string;
  nextAction: string;
  judgeUnavailable: boolean;
  rows: CriterionRow[];
  turns: TurnView[];
  metrics: Metrics | null;
}

export function objectiveDetail(result: CriterionResult): string {
  if (result.kind !== 'objective' || result.metric === undefined || result.actual === undefined) return result.detail;
  const value = formatMetricValue(result.metric, result.actual);
  return result.target ? `${value}, target ${result.target}` : value;
}

function rowFromResult(result: CriterionResult): CriterionRow {
  return {
    id: result.id,
    label: result.label,
    kind: result.kind,
    state: result.passed ? 'met' : 'not-met',
    detail: result.kind === 'objective' ? objectiveDetail(result) : result.detail,
    mayChange: false,
  };
}

function paceRange(rubric: Rubric): readonly [number, number] | null {
  const pace = rubric.objective.find((c) => c.metric === 'wpm' && c.op === 'between');
  return pace && pace.op === 'between' ? pace.value : null;
}

function turnDuration(words: readonly Word[], recorded: number | undefined): number {
  const lastEnd = words.at(-1)?.end ?? 0;
  return Math.max(recorded ?? 0, lastEnd);
}

export function buildReportModel(detail: AttemptDetailResponse): ReportModel {
  const { attempt, scenario, provisional } = detail;
  const verdict = attempt.verdict;
  const metrics = attempt.metrics ?? provisional?.metrics ?? null;
  const totalCount = scenario.rubric.objective.length + scenario.rubric.judged.length;

  let rows: CriterionRow[];
  if (verdict) {
    // A judged row whose detail is just the evidence would repeat the strength line above it.
    rows = verdict.criteria.map((r) => {
      const row = rowFromResult(r);
      return r.kind === 'judged' && r.detail === verdict.evidence ? { ...row, detail: '' } : row;
    });
  } else {
    const ambiguousPending = (provisional?.ambiguous.length ?? 0) > 0;
    const objective = (provisional?.objective ?? []).map((r) => ({
      ...rowFromResult(r),
      mayChange: ambiguousPending && r.metric === 'fillersPerMinute',
    }));
    const judged = scenario.rubric.judged.map<CriterionRow>((c) => ({
      id: c.id,
      label: c.label,
      kind: 'judged',
      state: 'pending',
      detail: `Checking ${c.label.toLowerCase()}`,
      mayChange: false,
    }));
    rows = [...objective, ...judged];
  }

  const range = paceRange(scenario.rubric);
  const drift = metrics && range ? paceDriftRanges(metrics.paceWindows, range) : [];
  const turns = attempt.turns.map<TurnView>((t) => ({
    index: t.index,
    aiText: t.aiText,
    words: t.words,
    audioId: t.audioId,
    durationSec: turnDuration(t.words, t.audioDurationSec),
    fillerMarks: (metrics?.fillerMarks ?? []).filter((m) => m.turnIndex === t.index),
    pauseMarks: (metrics?.pauseMarks ?? []).filter((m) => m.turnIndex === t.index),
    paceDrift: drift.filter((d) => d.turnIndex === t.index),
  }));

  return {
    verdict: verdict ? (verdict.passed ? 'passed' : 'not-yet') : 'pending',
    passedCount: verdict ? verdict.passedCount : null,
    totalCount,
    evidence: verdict?.evidence ?? '',
    nextAction: verdict?.nextAction ?? '',
    judgeUnavailable: verdict?.judgeUnavailable ?? false,
    rows,
    turns,
    metrics,
  };
}
