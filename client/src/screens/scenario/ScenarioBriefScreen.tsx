import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, Clock, Mic, MessagesSquare } from 'lucide-react';
import { interpolate, type ScenarioDetailResponse, type UserInputValues } from '@rehearsal/shared';
import { MicDeniedHelp, useMicPermission } from '../../audio';
import { Button, Icon, InlineNotice, PageShell } from '../../components';
import { openAttemptSession } from './attemptSession';
import { formatDuration } from './format';
import { ScenarioLoadStates } from './ScenarioLoadStates';
import { readSetupValues, setupIsComplete } from './setupValues';
import { useScenario } from './useScenario';
import styles from './scenario.module.css';

interface MicNoticeProps {
  state: ReturnType<typeof useMicPermission>['state'];
  refused: boolean;
}

function MicNotice({ state, refused }: MicNoticeProps) {
  if (state === 'granted') return null;
  if (state === 'unsupported') {
    return (
      <InlineNotice tone="fail" title="This browser cannot record audio.">
        Open this page in a recent version of Chrome, Edge, Firefox or Safari.
      </InlineNotice>
    );
  }
  // Recovery steps for the browser in use (spec/screens.md: permission-denied is a built state).
  if (state === 'denied' || refused) return <MicDeniedHelp />;
  return (
    <InlineNotice tone="info" title="Begin will ask for your microphone.">
      Your browser shows a prompt next. Recordings are private to your account and used only to score your answers.
    </InlineNotice>
  );
}

interface BriefContentProps {
  data: ScenarioDetailResponse;
  userInputs: UserInputValues;
}

function BriefContent({ data, userInputs }: BriefContentProps) {
  const { scenario, summary } = data;
  const navigate = useNavigate();
  const mic = useMicPermission();
  const [refused, setRefused] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const session = useMemo(() => openAttemptSession(scenario.id, userInputs), [scenario.id, userInputs]);

  // Start the attempt now so turn 0's line and audio are ready by the time Begin is pressed.
  useEffect(() => {
    session.prefetchLine(0);
  }, [session]);

  // Only a missing API disables Begin. A 'denied' Permissions API state can be stale (settings changed
  // without a reload, embedded browsers), so Begin still asks getUserMedia, which is the real answer.
  const blocked = mic.state === 'unsupported';
  const turnCount = scenario.turns.length;

  const begin = async () => {
    if (mic.state !== 'granted') {
      setRequesting(true);
      const granted = await mic.request();
      setRequesting(false);
      if (!granted) {
        setRefused(true);
        return;
      }
    }
    session.markBegun();
    navigate(`/scenarios/${scenario.id}/live`);
  };

  return (
    <div className={styles.brief}>
      <p className={styles.scene}>{interpolate(scenario.brief.scene, userInputs)}</p>

      <section aria-labelledby="goal-heading" className={styles.goal}>
        <h2 id="goal-heading" className={styles.label}>
          Your goal
        </h2>
        <p className={styles.goalText}>{interpolate(scenario.brief.yourGoal, userInputs)}</p>
      </section>

      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading" className={styles.label}>
          To pass, you need to
        </h2>
        <ul role="list" className={styles.criteria}>
          {scenario.criteriaDisplay.map((line) => (
            <li key={line} className={styles.criterion}>
              <span className={styles.criterionIcon}>
                <Icon icon={Check} size="sm" />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <dl className={styles.meta}>
        <div className={styles.metaItem}>
          <dt>
            <Icon icon={MessagesSquare} size="sm" />
            <span className="visually-hidden">Turns</span>
          </dt>
          <dd>{turnCount === 1 ? '1 question' : `${turnCount} questions`}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt>
            <Icon icon={Clock} size="sm" />
            <span className="visually-hidden">Speaking time</span>
          </dt>
          <dd>Up to {formatDuration(summary.expectedDurationSec)} of speaking</dd>
        </div>
      </dl>

      <MicNotice state={mic.state} refused={refused} />

      <div className={styles.actions}>
        <Button size="lg" icon={Mic} onClick={() => void begin()} loading={requesting} disabled={blocked}>
          Begin
        </Button>
      </div>
    </div>
  );
}

export function ScenarioBriefScreen() {
  const { scenarioId = '' } = useParams();
  const { load, reload } = useScenario(scenarioId);
  const userInputs = useMemo(() => readSetupValues(scenarioId), [scenarioId]);

  if (load.status === 'ready' && !setupIsComplete(load.data.scenario.userInputs, userInputs)) {
    return <Navigate to={`/scenarios/${scenarioId}/setup`} replace />;
  }

  return (
    <PageShell
      title={load.status === 'ready' ? load.data.scenario.title : 'Brief'}
      eyebrow="The brief"
      header="minimal"
    >
      {load.status === 'ready' ? (
        <BriefContent data={load.data} userInputs={userInputs} />
      ) : (
        <ScenarioLoadStates load={load} onRetry={reload} />
      )}
    </PageShell>
  );
}
