import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, CircleDashed, Route, SearchX } from 'lucide-react';
import { TRACK_LABELS, type AttemptHistoryResponse, type ScenarioListResponse, type ScenarioSummary } from '@rehearsal/shared';
import { Button, Card, cx, EmptyState, ErrorState, Icon, LoadingState, PageShell, Select, TextInput } from '../../components';
import { getAttemptHistory, getScenarioList } from '../../api/libraryApi';
import { useRemote } from '../../api/useRemote';
import { formatDuration } from '../scenario/format';
import { DifficultyMeter } from './DifficultyMeter';
import {
  bestResults,
  DIFFICULTY_LEVELS,
  difficultyLabel,
  EMPTY_FILTER,
  filterTracks,
  isFiltered,
  scenarioHref,
  tracksWithContent,
  type BestResult,
  type ExploreFilter,
} from './exploreModel';
import styles from './ExploreScreen.module.css';

interface ExploreData {
  list: ScenarioListResponse;
  history: AttemptHistoryResponse;
}

const NO_HISTORY: AttemptHistoryResponse = { groups: [] };

/** The library is required; history only adds best results, so its failure never blocks browsing. */
async function loadExplore(signal: AbortSignal): Promise<ExploreData> {
  const [list, history] = await Promise.all([
    getScenarioList(signal),
    getAttemptHistory(signal).catch(() => NO_HISTORY),
  ]);
  return { list, history };
}

function turnsLabel(count: number): string {
  return count === 1 ? '1 turn' : `${count} turns`;
}

function BestLine({ best }: { best: BestResult }) {
  return (
    <p className={cx(styles.best, best.passed && styles.bestPassed)}>
      <Icon icon={best.passed ? CircleCheck : CircleDashed} size="sm" />
      <span>
        Your best: {best.passed ? 'passed, ' : ''}
        {best.passedCount} of {best.totalCount} criteria
      </span>
    </p>
  );
}

function ScenarioCard({ scenario, best }: { scenario: ScenarioSummary; best: BestResult | undefined }) {
  return (
    <li className={styles.item}>
      <Link to={scenarioHref(scenario)} className={styles.link}>
        <Card as="article" className={styles.card}>
          <div className={styles.cardTop}>
            <DifficultyMeter level={scenario.difficulty} label={difficultyLabel(scenario.difficulty)} />
            {scenario.onPath && (
              <span className={styles.onPath}>
                <Icon icon={Route} size="sm" />
                On your path
              </span>
            )}
          </div>
          <h3 className={styles.title}>{scenario.title}</h3>
          <p className={styles.description}>{scenario.description}</p>
          <p className={styles.meta}>
            {turnsLabel(scenario.turnCount)} <span aria-hidden="true">·</span> about{' '}
            {formatDuration(scenario.expectedDurationSec)}
          </p>
          {best && <BestLine best={best} />}
        </Card>
      </Link>
    </li>
  );
}

interface FiltersProps {
  filter: ExploreFilter;
  trackOptions: { value: string; label: string }[];
  onChange: (filter: ExploreFilter) => void;
}

function Filters({ filter, trackOptions, onChange }: FiltersProps) {
  return (
    <div className={styles.filters} role="search" aria-label="Filter scenarios">
      <div className={styles.search}>
        <TextInput
          label="Search"
          type="search"
          value={filter.query}
          placeholder="Title or description"
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
        />
      </div>
      {trackOptions.length > 1 && (
        <Select
          label="Track"
          value={filter.track}
          options={[{ value: 'all', label: 'All tracks' }, ...trackOptions]}
          onChange={(event) => onChange({ ...filter, track: event.target.value as ExploreFilter['track'] })}
        />
      )}
      <Select
        label="Difficulty"
        value={String(filter.difficulty)}
        options={[
          { value: 'any', label: 'Any' },
          ...DIFFICULTY_LEVELS.map((level) => ({ value: String(level), label: `${level} · ${difficultyLabel(level)}` })),
        ]}
        onChange={(event) =>
          onChange({ ...filter, difficulty: event.target.value === 'any' ? 'any' : Number(event.target.value) })
        }
      />
    </div>
  );
}

function Library({ data }: { data: ExploreData }) {
  const [filter, setFilter] = useState<ExploreFilter>(EMPTY_FILTER);
  const tracks = useMemo(() => tracksWithContent(data.list), [data.list]);
  const best = useMemo(() => bestResults(data.history.groups), [data.history.groups]);
  const visible = filterTracks(tracks, filter);
  const moreComing = tracks.length < data.list.tracks.length;
  const total = visible.reduce((sum, t) => sum + t.scenarios.length, 0);

  return (
    <div className={styles.stack}>
      <Filters filter={filter} trackOptions={tracks.map((t) => ({ value: t.track, label: t.label }))} onChange={setFilter} />
      <p className={styles.resultCount} role="status">
        {total === 1 ? '1 scenario' : `${total} scenarios`}
      </p>
      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No scenario matches those filters."
          action={
            <Button variant="secondary" onClick={() => setFilter(EMPTY_FILTER)}>
              Clear filters
            </Button>
          }
        />
      ) : (
        visible.map((track) => (
          <section key={track.track} aria-labelledby={`track-${track.track}`} className={styles.track}>
            <h2 id={`track-${track.track}`} className={styles.trackTitle}>
              {TRACK_LABELS[track.track]}
              <span className={styles.trackCount}>{track.scenarios.length}</span>
            </h2>
            <ul role="list" className={styles.grid}>
              {track.scenarios.map((scenario) => (
                <ScenarioCard key={scenario.id} scenario={scenario} best={best.get(scenario.id)} />
              ))}
            </ul>
          </section>
        ))
      )}
      {moreComing && !isFiltered(filter) && <p className={styles.quiet}>More tracks are on the way.</p>}
    </div>
  );
}

export function ExploreScreen() {
  const { load, reload } = useRemote(loadExplore);

  return (
    <PageShell title="Explore" width="wide" lead="Every scenario, grouped by track. Open any of them, whatever your path says.">
      {load.status === 'loading' && <LoadingState message="Loading the library" />}
      {load.status === 'error' && <ErrorState title="The library did not load." message={load.message} onRetry={reload} />}
      {load.status === 'ready' && <Library data={load.data} />}
    </PageShell>
  );
}
