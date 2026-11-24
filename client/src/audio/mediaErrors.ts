export type RecorderErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'insecure-context'
  | 'recorder-failed';

export interface RecorderError {
  code: RecorderErrorCode;
  /** Plain-language message for the interface: what happened and what to do. */
  message: string;
}

const MESSAGES: Record<RecorderErrorCode, string> = {
  unsupported: 'This browser cannot record audio. Try a recent version of Chrome, Edge, Firefox or Safari.',
  'permission-denied': 'Microphone access is blocked. Enable it in your browser site settings and reload.',
  'no-device': 'No microphone was found. Connect one and try again.',
  'device-busy': 'Your microphone is in use by another app. Close it and try again.',
  'insecure-context': 'Recording needs a secure connection. Open the site over https.',
  'recorder-failed': 'Recording stopped unexpectedly. Try again.',
};

export function recorderError(code: RecorderErrorCode): RecorderError {
  return { code, message: MESSAGES[code] };
}

/** Map a getUserMedia / MediaRecorder failure to a RecorderError. */
export function toRecorderError(error: unknown): RecorderError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return recorderError('permission-denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return recorderError('no-device');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return recorderError('device-busy');
    default:
      return recorderError('recorder-failed');
  }
}

/**
 * Raw capture. Phase 0: browser noise suppression and AGC can strip "um" and "uh" before
 * Whisper sees them, which silently breaks filler counting. Ask for the unprocessed signal.
 */
export const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export function mediaDevicesAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
