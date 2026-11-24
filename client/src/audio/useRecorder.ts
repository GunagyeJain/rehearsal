import { useCallback, useEffect, useRef, useState } from 'react';
import { pickBrowserMimeType } from './mime';
import {
  mediaDevicesAvailable,
  RAW_AUDIO_CONSTRAINTS,
  recorderError,
  stopStream,
  toRecorderError,
  type RecorderError,
} from './mediaErrors';
import { DEFAULT_SILENCE_THRESHOLDS, INITIAL_SILENCE_STATE, rmsOf, stepSilence, type SilenceState } from './silence';

export interface RecorderOptions {
  /** Hard stop. */
  maxSeconds: number;
  /** Auto-stop after this much silence, once speech has been heard. */
  silenceStopSeconds: number;
  /** Silence never auto-stops before this. */
  minSeconds: number;
}

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
}

export interface Recorder {
  status: RecorderStatus;
  start: () => Promise<void>;
  stop: () => void;
  elapsedSec: number;
  /** Live analyser for LiveWaveform while recording; null otherwise. */
  analyser: AnalyserNode | null;
  result: RecordingResult | null;
  error: RecorderError | null;
  /** True when the last recording ended on silence or the time cap rather than stop(). */
  autoStopped: boolean;
  /** True once sustained speech has been heard in the current recording. */
  speechDetected: boolean;
}

const TICK_MS = 50;
const ELAPSED_STEP_SEC = 0.1;
const FFT_SIZE = 2048;
/** MediaRecorder flushes a chunk this often, so a crash loses at most this much audio. */
const CHUNK_MS = 1000;
const FALLBACK_MIME = 'audio/webm';

interface Session {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  recorder: MediaRecorder;
  chunks: Blob[];
  samples: Float32Array<ArrayBuffer>;
  startedAt: number;
  timer: number;
  silence: SilenceState;
  durationSec: number;
  autoStopped: boolean;
  disposed: boolean;
}

function releaseSession(session: Session): void {
  window.clearInterval(session.timer);
  stopStream(session.stream);
  if (session.context.state !== 'closed') void session.context.close();
}

async function openSession(stream: MediaStream): Promise<Session> {
  const context = new AudioContext();
  // Safari starts contexts suspended even inside a gesture; the analyser reads zeros until resumed.
  await context.resume().catch(() => undefined);
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  context.createMediaStreamSource(stream).connect(analyser);
  const mimeType = pickBrowserMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (err: unknown) {
    void context.close();
    throw err;
  }
  return {
    stream,
    context,
    analyser,
    recorder,
    chunks: [],
    samples: new Float32Array(analyser.fftSize),
    startedAt: 0,
    timer: 0,
    silence: INITIAL_SILENCE_STATE,
    durationSec: 0,
    autoStopped: false,
    disposed: false,
  };
}

/**
 * Microphone capture for one answer. Records the raw (unprocessed) signal with the best
 * supported container, auto-stops on silence (only after speech and after minSeconds) or at
 * maxSeconds, and always releases the microphone on stop or unmount.
 */
export function useRecorder(options: RecorderOptions): Recorder {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<RecorderError | null>(null);
  const [autoStopped, setAutoStopped] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const fail = useCallback((err: RecorderError) => {
    busyRef.current = false;
    setAnalyser(null);
    setError(err);
    setStatus('error');
  }, []);

  const requestStop = useCallback((session: Session, auto: boolean) => {
    if (session.recorder.state === 'inactive') return;
    window.clearInterval(session.timer);
    session.durationSec = Math.min(optionsRef.current.maxSeconds, (performance.now() - session.startedAt) / 1000);
    session.autoStopped = auto;
    if (!session.disposed) setStatus('stopping');
    session.recorder.stop();
  }, []);

  const finish = useCallback((session: Session) => {
    releaseSession(session);
    if (sessionRef.current === session) sessionRef.current = null;
    busyRef.current = false;
    if (session.disposed) return;
    const mimeType = session.recorder.mimeType || session.chunks[0]?.type || FALLBACK_MIME;
    setResult({ blob: new Blob(session.chunks, { type: mimeType }), mimeType, durationSec: session.durationSec });
    setAutoStopped(session.autoStopped);
    setElapsedSec(session.durationSec);
    setAnalyser(null);
    setStatus('idle');
  }, []);

  const tick = useCallback(
    (session: Session) => {
      const { maxSeconds, minSeconds, silenceStopSeconds } = optionsRef.current;
      const elapsed = (performance.now() - session.startedAt) / 1000;
      setElapsedSec(Math.floor(elapsed / ELAPSED_STEP_SEC) * ELAPSED_STEP_SEC);
      session.analyser.getFloatTimeDomainData(session.samples);
      const heardBefore = session.silence.speechDetected;
      session.silence = stepSilence(session.silence, rmsOf(session.samples), elapsed, {
        ...DEFAULT_SILENCE_THRESHOLDS,
        minSeconds,
        silenceStopSeconds,
      });
      if (!heardBefore && session.silence.speechDetected && !session.disposed) setSpeechDetected(true);
      if (elapsed >= maxSeconds || session.silence.shouldStop) requestStop(session, true);
    },
    [requestStop],
  );

  const begin = useCallback(
    (session: Session) => {
      session.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) session.chunks.push(event.data);
      };
      session.recorder.onstop = () => finish(session);
      session.recorder.onerror = () => {
        releaseSession(session);
        sessionRef.current = null;
        if (!session.disposed) fail(recorderError('recorder-failed'));
      };
      session.recorder.start(CHUNK_MS);
      session.startedAt = performance.now();
      session.timer = window.setInterval(() => tick(session), TICK_MS);
      sessionRef.current = session;
      setAnalyser(session.analyser);
      setStatus('recording');
    },
    [fail, finish, tick],
  );

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setResult(null);
    setError(null);
    setAutoStopped(false);
    setSpeechDetected(false);
    setElapsedSec(0);
    setStatus('starting');
    if (!window.isSecureContext) return fail(recorderError('insecure-context'));
    if (!mediaDevicesAvailable() || typeof MediaRecorder === 'undefined') return fail(recorderError('unsupported'));

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO_CONSTRAINTS });
      if (!mountedRef.current) return stopStream(stream);
      const session = await openSession(stream);
      // openSession awaits context.resume(); the screen may have unmounted meanwhile.
      if (!mountedRef.current) return releaseSession(session);
      begin(session);
    } catch (err: unknown) {
      stopStream(stream);
      if (mountedRef.current) fail(toRecorderError(err));
    }
  }, [begin, fail]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (session) requestStop(session, false);
  }, [requestStop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (!session) return;
      session.disposed = true;
      if (session.recorder.state !== 'inactive') session.recorder.stop();
      releaseSession(session);
      sessionRef.current = null;
    };
  }, []);

  return { status, start, stop, elapsedSec, analyser, result, error, autoStopped, speechDetected };
}
