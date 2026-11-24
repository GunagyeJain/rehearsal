import { Check, Mic, RotateCcw, Square } from 'lucide-react';
import { BASELINE_MAX_SECONDS, BASELINE_MIN_SECONDS, type BaselineResponse } from '@rehearsal/shared';
import { Button, InlineNotice, Spinner } from '../../components';
import { formatClock, LiveWaveform, MicDeniedHelp } from '../../audio';
import { OnboardingFrame } from './OnboardingFrame';
import { BASELINE_PROMPT } from './onboardingState';
import { useBaselineTake, type BaselinePhase, type BaselineTake } from './useBaselineTake';
import styles from './Onboarding.module.css';

interface BaselineStepProps {
  onBack: () => void;
  onDone: (result: BaselineResponse) => void;
  /** Onboarding moved on elsewhere (path exists or profile missing): re-sync with the server. */
  onClosed: () => void;
}

function statusLine(phase: BaselinePhase, elapsedSec: number): string {
  switch (phase.kind) {
    case 'speaking':
      return 'Listen to the question. Recording starts when it ends.';
    case 'ready':
      return 'Start when you are ready. Aim for about a minute.';
    case 'recording':
      return elapsedSec < BASELINE_MIN_SECONDS
        ? `Keep going. Done appears after ${BASELINE_MIN_SECONDS} seconds.`
        : 'Take your time. Select Done when you have finished.';
    case 'processing':
      return 'Listening back to your answer';
    default:
      return '';
  }
}

function Controls({ take, onBack, onClosed }: { take: BaselineTake; onBack: () => void; onClosed: () => void }) {
  const { phase, recorder } = take;
  if (phase.kind === 'speaking') {
    return (
      <Button variant="secondary" icon={Mic} onClick={take.startRecording}>
        Start now
      </Button>
    );
  }
  if (phase.kind === 'ready') {
    return (
      <Button icon={Mic} onClick={take.startRecording}>
        Start recording
      </Button>
    );
  }
  if (phase.kind === 'recording') {
    const canFinish = recorder.status === 'recording' && recorder.elapsedSec >= BASELINE_MIN_SECONDS;
    return (
      <Button icon={canFinish ? Check : Square} onClick={take.finish} disabled={!canFinish}>
        Done
      </Button>
    );
  }
  if (phase.kind === 'processing') return <Spinner label="Listening back to your answer" />;

  const { error } = phase;
  if (error.kind === 'closed') return <Button onClick={onClosed}>Continue</Button>;
  if (error.kind === 'mic-denied') {
    return (
      <>
        <Button icon={RotateCcw} onClick={take.startRecording}>
          Try again
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </>
    );
  }
  return (
    <>
      {error.kind === 'upload-failed' && (
        <Button icon={RotateCcw} onClick={take.retryUpload}>
          Try again
        </Button>
      )}
      <Button
        variant={error.kind === 'upload-failed' ? 'secondary' : 'primary'}
        icon={Mic}
        onClick={take.startRecording}
      >
        Record again
      </Button>
    </>
  );
}

/** The spoken baseline: prompt voiced and shown large, live waveform, 120 s cap, manual Done. */
export function BaselineStep({ onBack, onDone, onClosed }: BaselineStepProps) {
  const take = useBaselineTake(onDone);
  const { phase, recorder } = take;
  const recording = phase.kind === 'recording';
  const busy = phase.kind === 'processing';
  const status = statusLine(phase, recorder.elapsedSec);

  return (
    <OnboardingFrame step="baseline" title={BASELINE_PROMPT} hideTitle layout="stage" onBack={onBack} backDisabled={busy}>
      <div className={styles.baseline}>
        <p className={styles.prompt} aria-hidden="true">
          {BASELINE_PROMPT}
        </p>
        <div className={styles.micCard} data-active={recording || undefined}>
          <LiveWaveform
            analyser={recorder.analyser}
            active={recording && recorder.status === 'recording'}
            label="Your microphone level"
            className={styles.waveform}
          />
          <div className={styles.micRow}>
            <span
              className={styles.timer}
              aria-label={`${formatClock(recorder.elapsedSec)} of ${formatClock(BASELINE_MAX_SECONDS)}`}
            >
              {formatClock(recorder.elapsedSec)} <span className={styles.timerMax}>/ {formatClock(BASELINE_MAX_SECONDS)}</span>
            </span>
            <div className={styles.micActions}>
              <Controls take={take} onBack={onBack} onClosed={onClosed} />
            </div>
          </div>
        </div>
        {status && (
          <p className={styles.status} role="status" aria-live="polite">
            {status}
          </p>
        )}
        {phase.kind === 'error' &&
          (phase.error.kind === 'mic-denied' ? (
            <MicDeniedHelp />
          ) : (
            <InlineNotice tone={phase.error.kind === 'closed' ? 'info' : 'warn'}>{phase.error.message}</InlineNotice>
          ))}
      </div>
    </OnboardingFrame>
  );
}
