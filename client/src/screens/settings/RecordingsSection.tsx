import { useEffect, useState } from 'react';
import { Lock, Mic, Pause, Play, Trash2 } from 'lucide-react';
import type { RecordingSummary } from '@rehearsal/shared';
import { formatClock, useAudioPlayer } from '../../audio';
import { Button, Card, CardHeader, Dialog, ErrorState, Icon, IconButton, InlineNotice, Spinner } from '../../components';
import { isApiError } from '../../api/client';
import { deleteAllRecordings, deleteRecording, fetchRecordingAudio, getRecordings } from '../../api/libraryApi';
import { useRemote } from '../../api/useRemote';
import { formatAttemptDate } from '../history/dates';
import { recordingsSummary, recordingTitle } from './recordingsFormat';
import styles from './SettingsScreen.module.css';

type PendingDelete = { kind: 'one'; recording: RecordingSummary } | { kind: 'all' } | null;

interface ActiveAudio {
  id: string;
  blob: Blob;
  durationSec: number;
}

function messageOf(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/** Plays one recording at a time, fetched with the session cookie. */
function usePlayback() {
  const [active, setActive] = useState<ActiveAudio | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useAudioPlayer(active?.blob ?? null, { durationSec: active?.durationSec });
  const { play } = player;

  // Start as soon as a freshly fetched recording is attached to the player.
  useEffect(() => {
    if (active) void play();
  }, [active, play]);

  async function toggle(recording: RecordingSummary) {
    setError(null);
    if (active?.id === recording.id) {
      if (player.playing) player.pause();
      else void player.play();
      return;
    }
    player.pause();
    setLoadingId(recording.id);
    try {
      const blob = await fetchRecordingAudio(recording.id);
      setActive({ id: recording.id, blob, durationSec: recording.durationSec });
    } catch (caught: unknown) {
      setError(messageOf(caught, 'Retry, or delete it from the list.'));
    } finally {
      setLoadingId(null);
    }
  }

  function stopIf(id: string | null) {
    if (id === null || active?.id === id) {
      player.pause();
      setActive(null);
    }
  }

  return { active, player, loadingId, error, toggle, stopIf };
}

interface RowProps {
  recording: RecordingSummary;
  playing: boolean;
  loading: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function RecordingRow({ recording, playing, loading, onToggle, onDelete }: RowProps) {
  const title = recordingTitle(recording);
  return (
    <li className={styles.recording}>
      {loading ? (
        <span className={styles.recordingSpinner}>
          <Spinner size="sm" label={`Loading ${title}`} />
        </span>
      ) : (
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? `Pause ${title}` : `Play ${title}`}
          variant="secondary"
          onClick={onToggle}
        />
      )}
      <div className={styles.recordingText}>
        <p className={styles.recordingTitle}>{title}</p>
        <p className={styles.recordingMeta}>
          <time dateTime={recording.createdAt}>{formatAttemptDate(recording.createdAt)}</time>
          <span aria-hidden="true"> · </span>
          {formatClock(recording.durationSec)}
        </p>
      </div>
      <IconButton icon={Trash2} label={`Delete ${title}`} onClick={onDelete} />
    </li>
  );
}

export function RecordingsSection() {
  const { load, reload, setData } = useRemote(getRecordings);
  const playback = usePlayback();
  const [pending, setPending] = useState<PendingDelete>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (pending.kind === 'all') {
        await deleteAllRecordings();
        playback.stopIf(null);
        setData(() => ({ count: 0, totalBytes: 0, recordings: [] }));
      } else {
        const { id } = pending.recording;
        await deleteRecording(id);
        playback.stopIf(id);
        setData((data) => {
          const recordings = data.recordings.filter((r) => r.id !== id);
          return { count: recordings.length, totalBytes: recordings.reduce((s, r) => s + r.sizeBytes, 0), recordings };
        });
      }
      setPending(null);
    } catch (caught: unknown) {
      setDeleteError(messageOf(caught, 'Check your connection and try again.'));
    } finally {
      setDeleting(false);
    }
  }

  const playingId = playback.player.playing ? playback.active?.id : null;

  return (
    <Card as="section" padding="lg" aria-labelledby="recordings-heading">
      <CardHeader id="recordings-heading" title="Recordings" />
      {load.status === 'ready' && load.data.count > 0 && (
        <p className={styles.summary}>{recordingsSummary(load.data.count, load.data.totalBytes)}</p>
      )}
      <p className={styles.privacy}>
        <Icon icon={Lock} size="sm" />
        <span>
          Your recordings are private to this account. Only you can play them. Deleting one keeps its transcript and
          scores, so your history stays intact.
        </span>
      </p>

      {load.status === 'loading' && <Spinner label="Loading your recordings" />}
      {load.status === 'error' && <ErrorState title="Your recordings did not load." message={load.message} onRetry={reload} />}
      {load.status === 'ready' && load.data.count === 0 && (
        <p className={styles.emptyRecordings}>
          <Icon icon={Mic} size="sm" />
          No recordings stored. Answers you record will be listed here.
        </p>
      )}
      {playback.error && (
        <InlineNotice tone="fail" title="This recording did not play.">
          {playback.error}
        </InlineNotice>
      )}
      {load.status === 'ready' && load.data.count > 0 && (
        <>
          <ul role="list" className={styles.recordings}>
            {load.data.recordings.map((recording) => (
              <RecordingRow
                key={recording.id}
                recording={recording}
                playing={playingId === recording.id}
                loading={playback.loadingId === recording.id}
                onToggle={() => void playback.toggle(recording)}
                onDelete={() => setPending({ kind: 'one', recording })}
              />
            ))}
          </ul>
          <div className={styles.recordingsActions}>
            <Button variant="danger" icon={Trash2} onClick={() => setPending({ kind: 'all' })}>
              Delete all recordings
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={pending !== null}
        tone="danger"
        title={pending?.kind === 'all' ? 'Delete every recording?' : 'Delete this recording?'}
        description={
          pending?.kind === 'all'
            ? 'All of your audio is removed for good. Transcripts, scores and history stay.'
            : `${pending ? recordingTitle(pending.recording) : ''} is removed for good. Its transcript and scores stay.`
        }
        confirmLabel={pending?.kind === 'all' ? 'Delete all recordings' : 'Delete recording'}
        confirmLoading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPending(null);
          setDeleteError(null);
        }}
      >
        {deleteError && (
          <InlineNotice tone="fail" title="The recording was not deleted.">
            {deleteError}
          </InlineNotice>
        )}
      </Dialog>
    </Card>
  );
}
