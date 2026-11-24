import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, Mic, Play, RotateCcw, X } from 'lucide-react';
import type { PublicScenario } from '@rehearsal/shared';
import { formatClock, LiveWaveform, MicDeniedHelp } from '../../audio';
import { Button, cx, Dialog, EmptyState, ErrorState, IconButton, InlineNotice, LoadingState, PageShell, Spinner } from '../../components';
import { closeAttemptSession, getAttemptSession, type AttemptSession } from './attemptSession';
import { SpokenLine } from './live/SpokenLine';
import { useLiveScenario, type LiveMessage, type LivePhase } from './live/useLiveScenario';
import { useScenario } from './useScenario';
import { useShowTranscript } from './live/useShowTranscript';
import styles from './live/LiveScreen.module.css';

function statusLine(phase: LivePhase, recording: boolean, speaking = false): string {
  switch (phase.kind) {
    case 'starting':
    case 'ai-thinking':
      return 'Getting the question ready';
    case 'ai-speaking':
      return 'Listen, then answer';
    case 'ai-ready':
      return 'Ready when you are';
    case 'user-recording':
      if (!recording) return 'Starting the microphone';
      return speaking ? 'Listening' : 'Your turn. Speak when ready';
    case 'processing':
      return 'Transcribing your answer';
    case 'finalizing':
      return 'Preparing your report';
    case 'error':
      return 'Paused';
  }
}

interface HistoryProps {
  messages: readonly LiveMessage[];
}

/**
 * Earlier turns. The region keeps a guaranteed peek height (see .hasHistory in the CSS), so a long
 * AI line can never squeeze it to nothing; it scrolls on its own and pins to the newest turn.
 */
function History({ messages }: HistoryProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    // Scroll this region only: scrollIntoView would also scroll the full-height page.
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) return <div className={styles.scroll} />;
  return (
    <div
      ref={scrollRef}
      className={cx(styles.scroll, styles.hasHistory)}
      tabIndex={0}
      role="region"
      aria-label="Conversation so far"
    >
      <ol className={styles.history}>
        {messages.map((m) => (
          <li key={`${m.turn}-${m.speaker}`} className={cx(styles.message, m.speaker === 'ai' ? styles.fromAi : styles.fromUser)}>
            <span className={styles.speaker}>{m.speaker === 'ai' ? 'AI' : 'You'}</span>
            <p className={styles.messageText}>{m.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface LiveStageProps {
  scenario: PublicScenario;
  session: AttemptSession;
}

function LiveStage({ scenario, session }: LiveStageProps) {
  const navigate = useNavigate();
  const allowLeaveRef = useRef(false);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [showTranscript, toggleTranscript] = useShowTranscript();

  const onFinished = useCallback(
    (attemptId: string) => {
      allowLeaveRef.current = true;
      closeAttemptSession(session);
      navigate(`/attempts/${attemptId}`, { replace: true });
    },
    [navigate, session],
  );

  const live = useLiveScenario(scenario, session, onFinished);
  const { phase, recorder } = live;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return !allowLeaveRef.current && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowLeaveRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const recording = phase.kind === 'user-recording' && recorder.status === 'recording';

  // The control that was just used unmounts as the turn moves on (Begin answer becomes Done, Done
  // becomes the next Begin answer). When that drops focus to the page, hand it to the new control.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    controlsRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [phase.kind, recording]);

  const speaking = recording && recorder.speechDetected;
  const recorderFailed = phase.kind === 'user-recording' && recorder.status === 'error';
  const aiActive = phase.kind === 'ai-speaking' || phase.kind === 'ai-ready' || phase.kind === 'ai-thinking';
  const userActive = phase.kind === 'user-recording';
  const maxSeconds = scenario.turns[live.turnIndex]?.userResponse.maxSeconds ?? 0;
  const history = live.messages.filter((m) => !(m.turn === live.turnIndex && m.speaker === 'ai' && phase.kind !== 'finalizing'));
  const error = phase.kind === 'error' ? phase.error : null;

  return (
    <div className={styles.stage}>
      <div className={styles.topBar}>
        <IconButton icon={X} label="Leave scenario" onClick={() => navigate('/')} />
        <p className={styles.progress}>
          {phase.kind === 'finalizing' ? scenario.title : `Question ${live.turnIndex + 1} of ${live.turnCount}`}
        </p>
        <IconButton
          icon={showTranscript ? ChevronUp : ChevronDown}
          label={showTranscript ? 'Hide conversation' : 'Show conversation'}
          pressed={showTranscript}
          onClick={toggleTranscript}
        />
      </div>

      {showTranscript ? <History messages={history} /> : <div className={styles.scroll} />}

      <section className={cx(styles.card, styles.aiCard, aiActive && styles.active)} aria-label="AI">
        <span className={styles.cardLabel}>
          <span className={cx(styles.dot, styles.dotAi)} aria-hidden="true" />
          AI
        </span>
        {live.currentLine ? (
          <div aria-live="polite">
            <SpokenLine
              key={`${live.turnIndex}-${live.currentLine}`}
              text={live.currentLine}
              revealing={phase.kind === 'ai-speaking'}
              durationSec={phase.kind === 'ai-speaking' ? phase.durationSec : 0}
            />
          </div>
        ) : (
          <div className={styles.thinking}>
            <Spinner size="sm" label={statusLine(phase, recording)} />
            <span aria-hidden="true">{statusLine(phase, recording)}</span>
          </div>
        )}
        {phase.kind === 'ai-ready' && phase.reason === 'no-audio' && (
          <p className={styles.hint}>The voice is unavailable right now, so the question is shown as text.</p>
        )}
        {phase.kind === 'ai-ready' && phase.reason === 'blocked' && (
          <p className={styles.hint}>Your browser did not play the voice. Read the question, then begin.</p>
        )}
      </section>

      <section className={cx(styles.card, styles.micCard, userActive && styles.active)} aria-label="You">
        <div className={styles.micHeader}>
          <span className={styles.cardLabel}>
            <span className={cx(styles.dot, styles.dotUser)} aria-hidden="true" />
            You
          </span>
          {userActive && (
            <span className={styles.timer}>
              <span className="visually-hidden">{`Time used ${formatClock(recorder.elapsedSec)} of ${formatClock(maxSeconds)}`}</span>
              <span aria-hidden="true">
                {formatClock(recorder.elapsedSec)} <span className={styles.timerMax}>/ {formatClock(maxSeconds)}</span>
              </span>
            </span>
          )}
        </div>

        <LiveWaveform analyser={recorder.analyser} active={recording} className={styles.waveform} label="Your microphone level" />

        {/* Speech detection flickers the visible line; only the stable phase is announced. */}
        <p className={cx(styles.status, speaking && styles.statusQuiet)} aria-hidden="true">
          {statusLine(phase, recording, speaking)}
        </p>
        <p className="visually-hidden" role="status">
          {statusLine(phase, recording)}
        </p>

        {error && (
          <InlineNotice
            tone={error.recovery === 're-record' ? 'warn' : 'fail'}
            title={error.title}
            action={
              <Button variant="secondary" icon={error.recovery === 're-record' ? Mic : RotateCcw} onClick={live.recover}>
                {error.recovery === 're-record' ? 'Record again' : 'Retry'}
              </Button>
            }
          >
            {error.message}
          </InlineNotice>
        )}

        {recorderFailed && recorder.error && (
          <InlineNotice
            tone="fail"
            title="The microphone did not start."
            action={
              <Button variant="secondary" icon={RotateCcw} onClick={live.recover}>
                Retry
              </Button>
            }
          >
            {recorder.error.message}
          </InlineNotice>
        )}
        {recorderFailed && recorder.error?.code === 'permission-denied' && <MicDeniedHelp />}

        <div className={styles.controls} ref={controlsRef}>
          {(phase.kind === 'ai-ready' || phase.kind === 'ai-speaking') && (
            <Button size="lg" variant={phase.kind === 'ai-ready' ? 'primary' : 'secondary'} icon={phase.kind === 'ai-ready' ? Play : Mic} onClick={live.startAnswer}>
              {phase.kind === 'ai-ready' ? 'Begin answer' : 'Answer now'}
            </Button>
          )}
          {userActive && !recorderFailed && (
            <Button size="lg" icon={Check} onClick={live.finishAnswer} disabled={!recording} className={styles.done}>
              Done
            </Button>
          )}
        </div>
      </section>

      <Dialog
        open={blocker.state === 'blocked'}
        title="Leave this scenario?"
        description="Your answers so far will not be scored. You can start again from the brief."
        confirmLabel="Leave scenario"
        cancelLabel="Keep going"
        tone="danger"
        onConfirm={() => {
          // Drop the begun session so browser Back cannot remount on an attempt already left.
          allowLeaveRef.current = true;
          closeAttemptSession(session);
          blocker.proceed?.();
        }}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}

/** Full-bleed and chrome-free by design: no header, no navigation. */
export function ScenarioLiveScreen() {
  const { scenarioId = '' } = useParams();
  const { load, reload } = useScenario(scenarioId);
  const [session] = useState(() => getAttemptSession(scenarioId));

  let body;
  if (!session || !session.begun) {
    body = (
      <div className={styles.fallback}>
        <EmptyState
          icon={Mic}
          title="This session is not running."
          body="Scenarios start from the brief, so you can read the goal and criteria first."
          action={
            <Link to={`/scenarios/${scenarioId}/brief`} className={styles.fallbackLink}>
              Go to the brief
            </Link>
          }
        />
      </div>
    );
  } else if (load.status === 'loading') {
    body = <LoadingState message="Loading the scenario" />;
  } else if (load.status === 'error') {
    body = (
      <div className={styles.fallback}>
        <ErrorState title="The scenario could not load." message={load.message} onRetry={reload} />
      </div>
    );
  } else {
    body = <LiveStage scenario={load.data.scenario} session={session} />;
  }

  return (
    <PageShell title={load.status === 'ready' ? load.data.scenario.title : 'Live'} hideTitle header="none" width="full">
      {body}
    </PageShell>
  );
}
