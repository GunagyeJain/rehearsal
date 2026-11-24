import { useCallback, useEffect, useRef, useState } from 'react';
import { BASELINE_MAX_SECONDS, type BaselineResponse } from '@rehearsal/shared';
import { isApiError } from '../../api/client';
import {
  canSynthesizeSpeech,
  playTts,
  speakWithSynthesis,
  useRecorder,
  type Recorder,
  type RecordingResult,
} from '../../audio';
import { fetchTts } from '../scenario/scenarioApi';
import { uploadBaseline } from '../../path/pathApi';
import { BASELINE_PROMPT } from './onboardingState';

export type BaselineErrorKind = 'mic-denied' | 'recording-failed' | 'unusable-take' | 'upload-failed' | 'closed';

export interface BaselineError {
  kind: BaselineErrorKind;
  message: string;
}

export type BaselinePhase =
  | { kind: 'speaking' }
  /** The prompt could not be voiced (autoplay blocked or no audio): wait for a tap. */
  | { kind: 'ready' }
  | { kind: 'recording' }
  | { kind: 'processing' }
  | { kind: 'error'; error: BaselineError };

export interface BaselineTake {
  phase: BaselinePhase;
  recorder: Recorder;
  /** Start recording now (skips the spoken prompt if it is still playing). */
  startRecording: () => void;
  finish: () => void;
  /** Re-send the same take after an upload failure. */
  retryUpload: () => void;
}

/** Spoken words per second, to bound the browser-voice fallback. */
const SPOKEN_WORDS_PER_SEC = 2.6;
const UNUSABLE_TAKE_CODES = new Set(['NO_SPEECH', 'TRANSCRIPT_UNRELIABLE', 'MISSING_TIMESTAMPS']);

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function uploadError(error: unknown): BaselineError {
  if (isApiError(error)) {
    if (UNUSABLE_TAKE_CODES.has(error.code)) return { kind: 'unusable-take', message: error.message };
    if (error.code === 'PATH_EXISTS' || error.code === 'PROFILE_REQUIRED') return { kind: 'closed', message: error.message };
    if (error.code === 'PAYLOAD_TOO_LARGE' || error.code === 'UNSUPPORTED_MEDIA_TYPE') {
      return { kind: 'unusable-take', message: error.message };
    }
    return { kind: 'upload-failed', message: error.message };
  }
  return { kind: 'upload-failed', message: 'The recording could not be sent. Try again.' };
}

/**
 * The baseline take: voice the prompt (Groq TTS, else the browser voice), record with a live
 * waveform up to BASELINE_MAX_SECONDS with no silence auto-stop (manual Done), then upload.
 */
export function useBaselineTake(onDone: (result: BaselineResponse) => void): BaselineTake {
  const [phase, setPhase] = useState<BaselinePhase>({ kind: 'speaking' });
  // Silence never auto-stops a baseline: the stop threshold is past the cap.
  const recorder = useRecorder({ maxSeconds: BASELINE_MAX_SECONDS, minSeconds: 0, silenceStopSeconds: BASELINE_MAX_SECONDS + 1 });
  const speechRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const takeRef = useRef<RecordingResult | null>(null);
  const handledRef = useRef<RecordingResult | null>(null);
  const startRef = useRef(recorder.start);
  const stopRef = useRef(recorder.stop);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    startRef.current = recorder.start;
    stopRef.current = recorder.stop;
    onDoneRef.current = onDone;
  });

  const startRecording = useCallback(() => {
    speechRef.current?.abort();
    speechRef.current = null;
    setPhase({ kind: 'recording' });
    void startRef.current();
  }, []);

  const upload = useCallback(async (take: RecordingResult) => {
    setPhase({ kind: 'processing' });
    try {
      const result = await uploadBaseline(take);
      if (mountedRef.current) onDoneRef.current(result);
    } catch (error: unknown) {
      if (mountedRef.current) setPhase({ kind: 'error', error: uploadError(error) });
    }
  }, []);

  // Voice the prompt once on mount, then open the microphone.
  useEffect(() => {
    mountedRef.current = true;
    const speech = new AbortController();
    speechRef.current = speech;
    const voice = async (): Promise<'spoken' | 'aborted' | 'silent'> => {
      try {
        const audio = await fetchTts({ prompt: 'baseline' });
        if (speech.signal.aborted) return 'aborted';
        await playTts(audio, { signal: speech.signal });
        return 'spoken';
      } catch (error: unknown) {
        if (isAbort(error) || speech.signal.aborted) return 'aborted';
        // NotAllowedError means autoplay is blocked; the browser voice would be refused too.
        if (error instanceof DOMException && error.name === 'NotAllowedError') return 'silent';
      }
      if (!canSynthesizeSpeech()) return 'silent';
      try {
        const expectedSec = BASELINE_PROMPT.split(/\s+/).length / SPOKEN_WORDS_PER_SEC;
        await speakWithSynthesis(BASELINE_PROMPT, { signal: speech.signal, expectedSec });
        return 'spoken';
      } catch (error: unknown) {
        return isAbort(error) || speech.signal.aborted ? 'aborted' : 'silent';
      }
    };
    void voice().then((outcome) => {
      if (!mountedRef.current || speechRef.current !== speech) return;
      speechRef.current = null;
      if (outcome === 'spoken') startRecording();
      else if (outcome === 'silent') setPhase({ kind: 'ready' });
    });
    return () => {
      mountedRef.current = false;
      speech.abort();
    };
  }, [startRecording]);

  // A finished take uploads exactly once.
  useEffect(() => {
    const take = recorder.result;
    if (!take || handledRef.current === take) return;
    handledRef.current = take;
    takeRef.current = take;
    void upload(take);
  }, [recorder.result, upload]);

  // A recorder failure while recording surfaces as an error phase (derived, not stored).
  const recorderError = recorder.error;
  const visiblePhase: BaselinePhase =
    phase.kind === 'recording' && recorderError
      ? {
          kind: 'error',
          error: {
            kind: recorderError.code === 'permission-denied' ? 'mic-denied' : 'recording-failed',
            message: recorderError.message,
          },
        }
      : phase;

  const finish = useCallback(() => stopRef.current(), []);

  const retryUpload = useCallback(() => {
    const take = takeRef.current;
    if (take) void upload(take);
  }, [upload]);

  return { phase: visiblePhase, recorder, startRecording, finish, retryUpload };
}
