import { useEffect, useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import {
  decodePeaks,
  peaksFromWords,
  PlaybackWaveform,
  useAudioPlayer,
  type WaveformMark,
} from '../../../audio';
import { IconButton, Spinner } from '../../../components';
import { fetchRecording } from '../scenarioApi';
import type { TurnView } from './reportModel';
import styles from './Report.module.css';

const PEAK_BUCKETS = 600;

type AudioLoad =
  | { status: 'loading' }
  | { status: 'ready'; blob: Blob; peaks: number[] | null; mediaDurationSec: number | null }
  | { status: 'unavailable'; reason: 'deleted' | 'failed' };

interface TurnPlaybackProps {
  turn: TurnView;
  label: string;
  selectedMarkId: string | null;
  onMarkerSelect: (mark: WaveformMark) => void;
}

/** One turn's recording: fetched with the session cookie, decoded to peaks, scrubbable. */
export function TurnPlayback({ turn, label, selectedMarkId, onMarkerSelect }: TurnPlaybackProps) {
  const { audioId, words } = turn;
  const [load, setLoad] = useState<AudioLoad>(audioId ? { status: 'loading' } : { status: 'unavailable', reason: 'deleted' });

  useEffect(() => {
    if (!audioId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const blob = await fetchRecording(audioId, controller.signal);
        const decoded = await decodePeaks(blob, PEAK_BUCKETS).catch(() => null);
        if (!controller.signal.aborted) {
          setLoad({ status: 'ready', blob, peaks: decoded?.peaks ?? null, mediaDurationSec: decoded?.durationSec ?? null });
        }
      } catch {
        if (!controller.signal.aborted) setLoad({ status: 'unavailable', reason: 'failed' });
      }
    })();
    return () => controller.abort();
  }, [audioId]);

  // Word timestamps are offsets into the media itself, so the decoded length is the true timeline;
  // the stored length is only a fallback (recording deleted or undecodable).
  const durationSec = load.status === 'ready' && load.mediaDurationSec ? load.mediaDurationSec : turn.durationSec;
  const wordPeaks = useMemo(() => peaksFromWords(words, durationSec, PEAK_BUCKETS), [words, durationSec]);
  const player = useAudioPlayer(load.status === 'ready' ? load.blob : null, { durationSec });
  const hasAudio = load.status === 'ready';
  const peaks = hasAudio && load.peaks ? load.peaks : wordPeaks;
  const [markTime, setMarkTime] = useState(0);
  const currentTime = hasAudio ? player.currentTimeSec : markTime;

  const seek = (sec: number) => {
    if (hasAudio) player.seek(sec);
    else setMarkTime(sec);
  };

  return (
    <div className={styles.playback}>
      <div className={styles.playbackHeader}>
        {hasAudio ? (
          <IconButton
            icon={player.playing ? Pause : Play}
            label={player.playing ? `Pause ${label.toLowerCase()}` : `Play ${label.toLowerCase()}`}
            variant="secondary"
            onClick={() => (player.playing ? player.pause() : void player.play())}
          />
        ) : load.status === 'loading' ? (
          <Spinner size="sm" label="Loading the recording" />
        ) : null}
        {/* The time readout lives once, under the waveform beside its key. */}
        <span className={styles.playbackLabel}>{label}</span>
      </div>
      <PlaybackWaveform
        peaks={peaks}
        durationSec={durationSec}
        currentTimeSec={currentTime}
        fillerMarks={turn.fillerMarks}
        pauseMarks={turn.pauseMarks}
        paceDrift={turn.paceDrift}
        onSeek={seek}
        onMarkerSelect={onMarkerSelect}
        selectedMarkId={selectedMarkId}
        label={`${label} recording`}
      />
      {load.status === 'unavailable' && (
        <p className={styles.quiet}>
          {load.reason === 'deleted'
            ? 'This recording was deleted, so the waveform is drawn from your word timings.'
            : 'The recording could not load. The markers still show where each moment falls.'}
        </p>
      )}
    </div>
  );
}
