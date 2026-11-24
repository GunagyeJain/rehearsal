/**
 * Silence auto-stop as a pure state machine, fed one RMS sample per analyser tick.
 *
 * waiting  -> no speech yet. Silence here never stops the recording (the user may be thinking).
 * speaking -> speech has been heard; the level is above the silence floor.
 * silent   -> speech was heard, then the level fell below the floor at `silentSince`.
 *
 * It stops only when all hold: speech was detected, elapsed >= minSeconds, and the current
 * silence has lasted silenceStopSeconds. Hysteresis (speech threshold above the silence floor)
 * keeps breaths and room noise from flapping the state.
 */
export interface SilenceConfig {
  silenceStopSeconds: number;
  minSeconds: number;
  /** RMS that counts as speech. */
  speechRms: number;
  /** RMS below which the room counts as silent. Lower than speechRms. */
  silenceRms: number;
  /** Speech must be sustained this long to count, so a click or bump does not arm the detector. */
  speechConfirmSeconds: number;
}

export const DEFAULT_SILENCE_THRESHOLDS = {
  speechRms: 0.02,
  silenceRms: 0.01,
  speechConfirmSeconds: 0.25,
} as const;

export type SilencePhase = 'waiting' | 'speaking' | 'silent';

export interface SilenceState {
  phase: SilencePhase;
  speechDetected: boolean;
  /** Start of a run of above-threshold samples not yet confirmed as speech. */
  speechCandidateSince: number | null;
  silentSince: number | null;
  shouldStop: boolean;
}

export const INITIAL_SILENCE_STATE: SilenceState = {
  phase: 'waiting',
  speechDetected: false,
  speechCandidateSince: null,
  silentSince: null,
  shouldStop: false,
};

function confirmSpeech(state: SilenceState, rms: number, tSec: number, config: SilenceConfig): SilenceState {
  if (rms < config.speechRms) return { ...state, speechCandidateSince: null };
  const since = state.speechCandidateSince ?? tSec;
  if (tSec - since >= config.speechConfirmSeconds) {
    return { ...state, phase: 'speaking', speechDetected: true, speechCandidateSince: null, silentSince: null };
  }
  return { ...state, speechCandidateSince: since };
}

/** Advance the detector by one sample. `tSec` is seconds since recording started. */
export function stepSilence(state: SilenceState, rms: number, tSec: number, config: SilenceConfig): SilenceState {
  if (state.shouldStop) return state;
  if (state.phase === 'waiting') return confirmSpeech(state, rms, tSec, config);

  if (rms >= config.silenceRms) {
    // Back above the floor: any silence run is broken.
    return state.phase === 'speaking' ? state : { ...state, phase: 'speaking', silentSince: null };
  }

  const silentSince = state.silentSince ?? tSec;
  const silentFor = tSec - silentSince;
  const shouldStop = tSec >= config.minSeconds && silentFor >= config.silenceStopSeconds;
  return { ...state, phase: 'silent', silentSince, shouldStop };
}

/** Root-mean-square level of one block of time-domain samples (-1..1). */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}
