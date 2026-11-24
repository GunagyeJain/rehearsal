import { isApiError } from '../../../api/client';

/** What the retry button does after a mid-scenario failure. Earlier turns are never lost. */
export type LiveRecovery = 'retry-line' | 're-record' | 'retry-upload' | 'retry-finalize';

export interface LiveError {
  title: string;
  message: string;
  recovery: LiveRecovery;
}

const RE_RECORD_CODES = new Set(['NO_SPEECH', 'TRANSCRIPT_UNRELIABLE', 'MISSING_TIMESTAMPS', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE']);

function messageOf(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function lineError(error: unknown): LiveError {
  return {
    title: 'The next question did not arrive.',
    message: messageOf(error, 'The server could not prepare it. Retry in a moment.'),
    recovery: 'retry-line',
  };
}

/** Upload failures: an unusable take is re-recorded; a server or network failure re-sends the same take. */
export function uploadError(error: unknown): LiveError {
  if (isApiError(error) && error.code === 'TRANSCRIPT_UNRELIABLE') {
    return {
      title: 'We could not make out that answer clearly.',
      message: 'It was not scored. Record the same answer again, close to your usual speaking voice.',
      recovery: 're-record',
    };
  }
  if (isApiError(error) && error.code === 'NO_SPEECH') {
    return { title: 'We did not catch any speech.', message: 'Record that answer again.', recovery: 're-record' };
  }
  if (isApiError(error) && RE_RECORD_CODES.has(error.code)) {
    return { title: 'That recording could not be used.', message: error.message, recovery: 're-record' };
  }
  return {
    title: 'Your answer did not upload.',
    message: `${messageOf(error, 'The server could not receive it.')} Your recording is kept, so you can retry sending it.`,
    recovery: 'retry-upload',
  };
}

export function finalizeError(error: unknown): LiveError {
  return {
    title: 'Your answers are saved, but the report did not start.',
    message: messageOf(error, 'The server could not start scoring. Retry in a moment.'),
    recovery: 'retry-finalize',
  };
}
