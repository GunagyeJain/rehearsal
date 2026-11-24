/**
 * Recorder container choice. Chrome and Firefox record Opus in WebM; Safari only records AAC in MP4.
 * Order is preference: the first type the browser supports wins.
 */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

/** The best supported recorder mime type, or null to let the browser choose its default. */
export function pickRecorderMimeType(
  isSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = RECORDER_MIME_CANDIDATES,
): string | null {
  for (const candidate of candidates) {
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // Some engines throw on unknown parameters instead of returning false; treat as unsupported.
    }
  }
  return null;
}

/** pickRecorderMimeType against the real MediaRecorder, or null when MediaRecorder is missing. */
export function pickBrowserMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
}

/** The bare container type ("audio/webm") from a full mime string with codec parameters. */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim() ?? mimeType;
}
