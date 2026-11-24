import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicScenario } from '@rehearsal/shared';
import {
  canSynthesizeSpeech,
  playTts,
  speakWithSynthesis,
  useRecorder,
  wavDurationSec,
  type Recorder,
  type RecordingResult,
} from '../../../audio';
import type { AttemptSession, PreparedLine } from '../attemptSession';
import { finalizeAttempt, uploadAnswer } from '../scenarioApi';
import { finalizeError, lineError, uploadError, type LiveError } from './liveErrors';

/** Turn states from spec/screens.md section 6. */
export type LivePhase =
  | { kind: 'starting' }
  | { kind: 'ai-thinking'; turn: number }
  /** voice 'browser': /api/tts failed, so the browser's speech synthesis is speaking the line. */
  | { kind: 'ai-speaking'; turn: number; line: PreparedLine; durationSec: number; voice: 'tts' | 'browser' }
  /** The line is shown as text and waits for "Begin answer": no voice at all, or autoplay was blocked. */
  | { kind: 'ai-ready'; turn: number; line: PreparedLine; reason: 'no-audio' | 'blocked' }
  | { kind: 'user-recording'; turn: number }
  | { kind: 'processing'; turn: number }
  | { kind: 'finalizing' }
  | { kind: 'error'; turn: number; error: LiveError };

export interface LiveMessage {
  turn: number;
  speaker: 'ai' | 'user';
  text: string;
}

export interface LiveScenario {
  phase: LivePhase;
  messages: readonly LiveMessage[];
  /** The line on the big card for the turn in progress. */
  currentLine: string | null;
  recorder: Recorder;
  turnCount: number;
  /** Turn shown in the "Question n of m" indicator. */
  turnIndex: number;
  startAnswer: () => void;
  finishAnswer: () => void;
  recover: () => void;
}

/** Words per second used to pace the text reveal when the audio length is unknown. */
const SPOKEN_WORDS_PER_SEC = 2.6;
/** Unreachable for a valid scenario (schema requires one turn); keeps the recorder typed. */
const FALLBACK_LIMITS = { maxSeconds: 120, minSeconds: 0, silenceStopSeconds: 3 } as const;
/** Only show the thinking state when a line is genuinely not ready yet. */
const THINKING_DELAY_MS = 250;

function estimateSpokenSec(text: string): number {
  return text.split(/\s+/).filter(Boolean).length / SPOKEN_WORDS_PER_SEC;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** The browser refused to start audio without a user gesture; speech synthesis would be refused too. */
function isAutoplayBlocked(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

type VoiceOutcome = 'spoken' | 'aborted' | 'blocked' | 'unavailable';

function turnOf(phase: LivePhase): number {
  return 'turn' in phase ? phase.turn : 0;
}

function upsertMessage(list: readonly LiveMessage[], message: LiveMessage): LiveMessage[] {
  const rest = list.filter((m) => !(m.turn === message.turn && m.speaker === message.speaker));
  return [...rest, message].sort((a, b) => a.turn - b.turn || (a.speaker === 'ai' ? -1 : 1));
}

/**
 * The live turn state machine: speak the line, record the answer, upload it, move on, and
 * finalize after the last turn. Every await checks the screen's abort signal so nothing runs
 * after the user leaves.
 */
export function useLiveScenario(
  scenario: PublicScenario,
  session: AttemptSession,
  onFinished: (attemptId: string) => void,
): LiveScenario {
  const [phase, setPhase] = useState<LivePhase>({ kind: 'starting' });
  const [messages, setMessages] = useState<readonly LiveMessage[]>([]);
  const turnCount = scenario.turns.length;
  const turnIndex = Math.min(turnOf(phase), turnCount - 1);
  const limits = scenario.turns[turnIndex]?.userResponse ?? scenario.turns[0]?.userResponse;
  const recorder = useRecorder({
    maxSeconds: limits?.maxSeconds ?? FALLBACK_LIMITS.maxSeconds,
    minSeconds: limits?.minSeconds ?? FALLBACK_LIMITS.minSeconds,
    silenceStopSeconds: limits?.silenceStopSeconds ?? FALLBACK_LIMITS.silenceStopSeconds,
  });
  const signalRef = useRef<AbortSignal | null>(null);
  /** Aborts the line currently playing, so "Answer now" silences it before the mic opens. */
  const speechRef = useRef<AbortController | null>(null);
  const phaseRef = useRef<LivePhase>(phase);
  const takeRef = useRef<RecordingResult | null>(null);
  const handledResultRef = useRef<RecordingResult | null>(null);
  const startRecorderRef = useRef(recorder.start);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    startRecorderRef.current = recorder.start;
    onFinishedRef.current = onFinished;
  });

  const alive = useCallback(() => signalRef.current !== null && !signalRef.current.aborted, []);

  const changePhase = useCallback((next: LivePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const startRecording = useCallback(
    (turn: number) => {
      speechRef.current?.abort();
      speechRef.current = null;
      changePhase({ kind: 'user-recording', turn });
      void startRecorderRef.current();
      const next = scenario.turns[turn + 1];
      if (next && !next.dependsOnPreviousAnswer) session.prefetchLine(turn + 1);
    },
    [changePhase, scenario.turns, session],
  );

  /**
   * Voice one line: TTS audio when it arrived, else the browser's speech synthesis. The phase moves
   * to ai-speaking while a voice plays. Never throws: a scenario must not get stuck on audio.
   */
  const voiceLine = useCallback(
    async (turn: number, line: PreparedLine): Promise<VoiceOutcome> => {
      const speech = new AbortController();
      speechRef.current?.abort();
      speechRef.current = speech;
      const screen = signalRef.current;
      const stopSpeech = () => speech.abort();
      screen?.addEventListener('abort', stopSpeech, { once: true });
      const still = (speaking: LivePhase) => alive() && !speech.signal.aborted && phaseRef.current === speaking;
      try {
        if (line.audio) {
          const speaking: LivePhase = {
            kind: 'ai-speaking',
            turn,
            line,
            durationSec: wavDurationSec(line.audio) ?? estimateSpokenSec(line.text),
            voice: 'tts',
          };
          changePhase(speaking);
          try {
            await playTts(line.audio, { signal: speech.signal });
            return still(speaking) ? 'spoken' : 'aborted';
          } catch (error: unknown) {
            if (isAbort(error) || !still(speaking)) return 'aborted';
            if (isAutoplayBlocked(error)) return 'blocked';
            // Undecodable audio: fall through to the browser voice.
          }
        }
        if (!canSynthesizeSpeech()) return 'unavailable';
        const durationSec = estimateSpokenSec(line.text);
        const speaking: LivePhase = { kind: 'ai-speaking', turn, line, durationSec, voice: 'browser' };
        changePhase(speaking);
        try {
          await speakWithSynthesis(line.text, { signal: speech.signal, expectedSec: durationSec });
          return still(speaking) ? 'spoken' : 'aborted';
        } catch (error: unknown) {
          if (isAbort(error) || !still(speaking)) return 'aborted';
          return 'unavailable';
        }
      } finally {
        screen?.removeEventListener('abort', stopSpeech);
        if (speechRef.current === speech) speechRef.current = null;
      }
    },
    [alive, changePhase],
  );

  const speak = useCallback(
    async (turn: number) => {
      // Pre-generated lines resolve at once, so the thinking state only shows for a real wait.
      const thinking = window.setTimeout(() => {
        if (alive()) changePhase({ kind: 'ai-thinking', turn });
      }, THINKING_DELAY_MS);
      let line: PreparedLine;
      try {
        line = await session.prepareLine(turn);
      } catch (error: unknown) {
        window.clearTimeout(thinking);
        if (alive()) changePhase({ kind: 'error', turn, error: lineError(error) });
        return;
      }
      window.clearTimeout(thinking);
      if (!alive()) return;
      setMessages((list) => upsertMessage(list, { turn, speaker: 'ai', text: line.text }));
      const outcome = await voiceLine(turn, line);
      if (!alive() || outcome === 'aborted') return;
      // "Answer now" may already have moved on (recording, processing); never reopen the mic.
      if (outcome === 'spoken') startRecording(turn);
      else changePhase({ kind: 'ai-ready', turn, line, reason: outcome === 'blocked' ? 'blocked' : 'no-audio' });
    },
    [alive, changePhase, session, startRecording, voiceLine],
  );

  const finalize = useCallback(async () => {
    changePhase({ kind: 'finalizing' });
    try {
      const attemptId = await session.attemptId();
      await finalizeAttempt(attemptId);
      if (alive()) onFinishedRef.current(attemptId);
    } catch (error: unknown) {
      if (alive()) changePhase({ kind: 'error', turn: turnCount - 1, error: finalizeError(error) });
    }
  }, [alive, changePhase, session, turnCount]);

  const upload = useCallback(
    async (turn: number, take: RecordingResult) => {
      takeRef.current = take;
      changePhase({ kind: 'processing', turn });
      try {
        const attemptId = await session.attemptId();
        const response = await uploadAnswer(attemptId, turn, take);
        if (!alive()) return;
        takeRef.current = null;
        setMessages((list) => upsertMessage(list, { turn, speaker: 'user', text: response.turn.transcript }));
        if (response.allTurnsAnswered || turn + 1 >= turnCount) await finalize();
        else await speak(turn + 1);
      } catch (error: unknown) {
        if (alive()) changePhase({ kind: 'error', turn, error: uploadError(error) });
      }
    },
    [alive, changePhase, finalize, session, speak, turnCount],
  );

  /**
   * Continue from wherever the machine is. On first mount that is turn 0. When effects re-run with
   * state kept (a dev hot update re-runs every effect), the aborted step is resumed instead of
   * restarting the scenario: earlier turns are never lost.
   */
  const resume = useCallback(() => {
    const current = phaseRef.current;
    switch (current.kind) {
      case 'starting':
        void speak(0);
        break;
      case 'ai-thinking':
      case 'ai-speaking':
        void speak(current.turn);
        break;
      case 'user-recording':
        startRecording(current.turn);
        break;
      case 'processing':
        if (takeRef.current) void upload(current.turn, takeRef.current);
        else startRecording(current.turn);
        break;
      case 'finalizing':
        void finalize();
        break;
      case 'ai-ready':
      case 'error':
        // Already waiting on the user.
        break;
    }
  }, [finalize, speak, startRecording, upload]);
  const resumeRef = useRef(resume);
  useEffect(() => {
    resumeRef.current = resume;
  });

  useEffect(() => {
    const controller = new AbortController();
    signalRef.current = controller.signal;
    // Deferred a tick so a StrictMode remount cancels the first run before it starts.
    const timer = window.setTimeout(() => resumeRef.current(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  // A finished take (Done, silence or time cap) goes straight to upload.
  const { result } = recorder;
  useEffect(() => {
    if (!result || handledResultRef.current === result || phase.kind !== 'user-recording') return;
    handledResultRef.current = result;
    void upload(phase.turn, result);
  }, [result, phase, upload]);

  const startAnswer = useCallback(() => {
    if (phase.kind === 'ai-ready' || phase.kind === 'ai-speaking') startRecording(phase.turn);
  }, [phase, startRecording]);

  const finishAnswer = useCallback(() => {
    if (phase.kind === 'user-recording' && recorder.status === 'recording') recorder.stop();
  }, [phase.kind, recorder]);

  const recover = useCallback(() => {
    if (phase.kind === 'user-recording' && recorder.status === 'error') {
      startRecording(phase.turn);
      return;
    }
    if (phase.kind !== 'error') return;
    const { turn, error } = phase;
    switch (error.recovery) {
      case 'retry-line':
        void speak(turn);
        break;
      case 're-record':
        startRecording(turn);
        break;
      case 'retry-upload':
        if (takeRef.current) void upload(turn, takeRef.current);
        else startRecording(turn);
        break;
      case 'retry-finalize':
        void finalize();
        break;
    }
  }, [finalize, phase, recorder.status, speak, startRecording, upload]);

  const currentAi = messages.find((m) => m.turn === turnIndex && m.speaker === 'ai');

  return {
    phase,
    messages,
    currentLine: phase.kind === 'finalizing' ? null : (currentAi?.text ?? null),
    recorder,
    turnCount,
    turnIndex,
    startAnswer,
    finishAnswer,
    recover,
  };
}
