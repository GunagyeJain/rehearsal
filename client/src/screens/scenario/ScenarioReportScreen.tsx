import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronUp, CircleDashed, FileQuestion, RotateCcw, XCircle } from 'lucide-react';
import type { AttemptDetailResponse } from '@rehearsal/shared';
import type { WaveformMark } from '../../audio';
import { Button, cx, EmptyState, ErrorState, Icon, InlineNotice, LoadingState, PageShell, Spinner } from '../../components';
import { buildReportModel, type CriterionRow, type ReportModel } from './report/reportModel';
import { Transcript, type WordRef } from './report/Transcript';
import { TurnPlayback } from './report/TurnPlayback';
import { useAttemptReport } from './report/useAttemptReport';
import { ReportActions } from './report/ReportActions';
import styles from './report/Report.module.css';

function VerdictBlock({ model }: { model: ReportModel }) {
  if (model.verdict === 'pending') {
    return (
      <div className={styles.verdictPending} role="status">
        <Spinner size="sm" label="Checking your answer" />
        <span aria-hidden="true">Checking your answer. The measured results are below.</span>
      </div>
    );
  }
  const passed = model.verdict === 'passed';
  return (
    <div className={cx(styles.verdict, passed ? styles.verdictPassed : styles.verdictNotYet)}>
      <span className={styles.verdictIcon}>
        <Icon icon={passed ? CheckCircle2 : CircleDashed} size="lg" />
      </span>
      <div>
        <p className={styles.verdictText}>{passed ? 'Passed' : 'Not yet'}</p>
        {model.passedCount !== null && (
          <p className={styles.verdictCount}>
            {model.passedCount} of {model.totalCount} criteria met
          </p>
        )}
      </div>
    </div>
  );
}

function CriterionItem({ row }: { row: CriterionRow }) {
  const icon = row.state === 'met' ? CheckCircle2 : row.state === 'not-met' ? XCircle : null;
  const stateLabel = row.state === 'met' ? 'Met' : row.state === 'not-met' ? 'Not met' : 'Checking';
  return (
    <li className={cx(styles.criterion, styles[row.state === 'not-met' ? 'notMet' : row.state])}>
      <span className={styles.criterionIcon}>
        {icon ? <Icon icon={icon} label={stateLabel} /> : <Spinner size="sm" label={stateLabel} />}
      </span>
      <div className={styles.criterionText}>
        <p className={styles.criterionLabel}>{row.label}</p>
        {row.detail && (
          <p className={styles.criterionDetail}>
            {row.detail}
            {row.mayChange && <span className={styles.mayChange}> (may change once unclear words are checked)</span>}
          </p>
        )}
      </div>
    </li>
  );
}

interface ReportBodyProps {
  detail: AttemptDetailResponse;
  timedOut: boolean;
  pollFailed: boolean;
  onRetry: () => void;
}

function ReportBody({ detail, timedOut, pollFailed, onRetry }: ReportBodyProps) {
  const model = useMemo(() => buildReportModel(detail), [detail]);
  const [selectedMark, setSelectedMark] = useState<WaveformMark | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const multiTurn = model.turns.length > 1;

  const highlighted: WordRef | null = selectedMark
    ? {
        turnIndex: selectedMark.turnIndex,
        wordIndex: selectedMark.wordIndex,
        wordCount:
          selectedMark.kind === 'filler'
            ? (model.turns
                .find((t) => t.index === selectedMark.turnIndex)
                ?.fillerMarks.find((m) => m.wordIndex === selectedMark.wordIndex)?.wordCount ?? 1)
            : 1,
      }
    : null;

  const selectMark = (mark: WaveformMark) => {
    setSelectedMark(mark);
    setTranscriptOpen(true);
  };

  return (
    <div className={styles.report}>
      <VerdictBlock model={model} />

      {timedOut && (
        <InlineNotice
          tone="warn"
          title="Scoring is taking longer than usual."
          action={<Button variant="secondary" icon={RotateCcw} onClick={onRetry}>Check again</Button>}
        >
          Your answers are saved. Some measured results may still change once scoring finishes.
        </InlineNotice>
      )}
      {pollFailed && (
        <InlineNotice
          tone="warn"
          title="The report stopped updating."
          action={<Button variant="secondary" icon={RotateCcw} onClick={onRetry}>Check again</Button>}
        >
          Check your connection, then check again.
        </InlineNotice>
      )}

      {model.evidence && (
        <section aria-labelledby="strength-heading" className={styles.strength}>
          <h2 id="strength-heading" className={styles.label}>
            What worked
          </h2>
          <p className={styles.strengthText}>{model.evidence}</p>
        </section>
      )}

      {model.verdict !== 'pending' && model.nextAction && (
        <section aria-labelledby="next-heading" className={styles.next}>
          <h2 id="next-heading" className={styles.label}>
            Next time
          </h2>
          <p className={styles.nextText}>{model.nextAction}</p>
        </section>
      )}

      {model.judgeUnavailable && (
        <InlineNotice tone="info" title="The structure check could not run this time.">
          It was not counted against you. Every other criterion below was measured as usual.
        </InlineNotice>
      )}

      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading" className={styles.label}>
          Criteria
        </h2>
        <ul role="list" className={styles.criteria}>
          {model.rows.map((row) => (
            <CriterionItem key={row.id} row={row} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="recording-heading" className={styles.recordings}>
        <h2 id="recording-heading" className={styles.label}>
          {multiTurn ? 'Your answers' : 'Your answer'}
        </h2>
        {model.turns.map((turn) => (
          <TurnPlayback
            key={turn.index}
            turn={turn}
            label={multiTurn ? `Answer ${turn.index + 1}` : 'Answer'}
            selectedMarkId={selectedMark?.turnIndex === turn.index ? selectedMark.id : null}
            onMarkerSelect={selectMark}
          />
        ))}
      </section>

      <section className={styles.transcriptSection}>
        <Button
          variant="ghost"
          className={styles.transcriptToggle}
          icon={transcriptOpen ? ChevronUp : ChevronDown}
          aria-expanded={transcriptOpen}
          aria-controls="report-transcript"
          onClick={() => setTranscriptOpen((open) => !open)}
        >
          {transcriptOpen ? 'Hide transcript' : 'Show full transcript'}
        </Button>
        <div id="report-transcript" hidden={!transcriptOpen}>
          {transcriptOpen && <Transcript turns={model.turns} highlighted={highlighted} />}
        </div>
      </section>

      <ReportActions detail={detail} verdict={model.verdict} />
    </div>
  );
}

export function ScenarioReportScreen() {
  const { attemptId = '' } = useParams();
  const { detail, error, timedOut, retry } = useAttemptReport(attemptId);

  let body;
  if (detail && (detail.attempt.status === 'in_progress' || detail.attempt.status === 'abandoned')) {
    body = (
      <EmptyState
        icon={FileQuestion}
        title="This attempt was not finished, so there is no report."
        action={<Link to={`/scenarios/${detail.scenario.id}/brief`}>Start it again from the brief</Link>}
      />
    );
  } else if (detail) {
    body = <ReportBody detail={detail} timedOut={timedOut} pollFailed={error !== null} onRetry={retry} />;
  } else if (error?.notFound) {
    body = (
      <EmptyState icon={FileQuestion} title="This report does not exist." action={<Link to="/">Go to your scenarios</Link>} />
    );
  } else if (error) {
    body = <ErrorState title="The report could not load." message={error.message} onRetry={retry} />;
  } else {
    body = <LoadingState message="Loading your report" />;
  }

  return (
    <PageShell title={detail?.scenario.title ?? 'Report'} eyebrow="Your report">
      {body}
    </PageShell>
  );
}
