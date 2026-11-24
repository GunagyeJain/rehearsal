import type { RecordingSummary } from '@rehearsal/shared';

const KB = 1024;
const MB = KB * 1024;

/** "0 KB", "48 KB", "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.round(bytes / KB)} KB`;
}

/** What the recording was: "Self-introduction, answer 2" or "Onboarding baseline". */
export function recordingTitle(recording: Pick<RecordingSummary, 'kind' | 'scenarioTitle' | 'turnIndex'>): string {
  if (recording.kind === 'baseline') return 'Onboarding baseline';
  const title = recording.scenarioTitle ?? 'A retired scenario';
  return recording.turnIndex === null ? title : `${title}, answer ${recording.turnIndex + 1}`;
}

/** "1 recording, 48 KB" / "3 recordings, 3.2 MB". */
export function recordingsSummary(count: number, totalBytes: number): string {
  const noun = count === 1 ? '1 recording' : `${count} recordings`;
  return `${noun}, ${formatBytes(totalBytes)}`;
}
