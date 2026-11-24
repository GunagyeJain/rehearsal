import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, CircleCheck, CircleDashed, Compass, History, Route } from 'lucide-react';
import { TRACK_LABELS, type AttemptHistoryEntry, type AttemptHistoryGroup } from '@rehearsal/shared';
import { Button, Card, EmptyState, ErrorState, Icon, LoadingState, PageShell } from '../../components';
import { getAttemptHistory } from '../../api/libraryApi';
import { useRemote } from '../../api/useRemote';
import { formatAttemptDate } from './dates';
import { seriesForGroup } from './trend';
import { TrendSparkline } from './TrendSparkline';
import styles from './HistoryScreen.module.css';

function AttemptRow({ attempt }: { attempt: AttemptHistoryEntry }) {
  return (
    <li>
      <Link to={`/attempts/${attempt.id}`} className={styles.attempt}>
        <span className={attempt.passed ? styles.passed : styles.notYet}>
          <Icon icon={attempt.passed ? CircleCheck : CircleDashed} size="sm" />
          {attempt.passed ? 'Passed' : 'Not yet'}
        </span>
        <span className={styles.attemptMeta}>
          {attempt.passedCount} of {attempt.totalCount} criteria
        </span>
        <time className={styles.attemptDate} dateTime={attempt.completedAt}>
          {formatAttemptDate(attempt.completedAt)}
        </time>
        <span className={styles.chevron}>
          <Icon icon={ChevronRight} size="sm" label="Open the report" />
        </span>
      </Link>
    </li>
  );
}

function ScenarioGroup({ group }: { group: AttemptHistoryGroup }) {
  const headingId = `history-${group.scenario.id}`;
  const count = group.attempts.length;
  return (
    <Card as="section" padding="lg" aria-labelledby={headingId} className={styles.group}>
      <header className={styles.groupHeader}>
        <div>
          <p className={styles.eyebrow}>{TRACK_LABELS[group.scenario.track]}</p>
          <h2 id={headingId} className={styles.groupTitle}>
            {group.scenario.title}
          </h2>
        </div>
        <span className={styles.count}>{count === 1 ? '1 attempt' : `${count} attempts`}</span>
      </header>
      {count > 1 ? (
        <div className={styles.trends}>
          {seriesForGroup(group).map((series) => (
            <TrendSparkline key={series.id} series={series} />
          ))}
        </div>
      ) : (
        <p className={styles.quiet}>Attempt it again to see how each measure moves.</p>
      )}
      <ol role="list" className={styles.attempts} aria-label={`Attempts at ${group.scenario.title}, newest first`}>
        {group.attempts.map((attempt) => (
          <AttemptRow key={attempt.id} attempt={attempt} />
        ))}
      </ol>
    </Card>
  );
}

export function HistoryScreen() {
  const { load, reload } = useRemote(getAttemptHistory);
  const navigate = useNavigate();

  return (
    <PageShell title="History" lead="Every attempt, newest first, with how each measure moved over time.">
      {load.status === 'loading' && <LoadingState message="Loading your attempts" />}
      {load.status === 'error' && <ErrorState title="Your history did not load." message={load.message} onRetry={reload} />}
      {load.status === 'ready' && load.data.groups.length === 0 && (
        <EmptyState
          icon={History}
          title="Your first attempt will appear here."
          body="Finish a scenario and its report, measures and trend land on this page."
          action={
            <Button icon={Route} onClick={() => navigate('/')}>
              Go to your path
            </Button>
          }
        />
      )}
      {load.status === 'ready' && load.data.groups.length > 0 && (
        <div className={styles.stack}>
          {load.data.groups.map((group) => (
            <ScenarioGroup key={group.scenario.id} group={group} />
          ))}
          <p className={styles.footerNote}>
            <Icon icon={Compass} size="sm" />
            <Link to="/explore">Find another scenario in Explore</Link>
          </p>
        </div>
      )}
    </PageShell>
  );
}
