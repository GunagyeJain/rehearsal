/**
 * A silent, speech-shaped signal feeding an AnalyserNode, for reviewing LiveWaveform without a
 * microphone (the /design page). An oscillator is gated by a gain envelope of syllable bursts
 * and phrase gaps; it is never connected to the speakers.
 */
export interface SyntheticAnalyser {
  analyser: AnalyserNode;
  stop: () => void;
}

const SCHEDULE_AHEAD_SEC = 0.6;
const SCHEDULER_MS = 100;

function nextSyllable(gain: GainNode, at: number): number {
  const length = 0.08 + Math.random() * 0.18;
  const peak = 0.006 + Math.random() * Math.random() * 0.2;
  gain.gain.setTargetAtTime(peak, at, 0.015);
  gain.gain.setTargetAtTime(0.0008, at + length, 0.03);
  // Mostly short gaps between syllables, sometimes a breath, occasionally a long pause.
  const roll = Math.random();
  const gap = roll < 0.75 ? 0.04 + Math.random() * 0.08 : roll < 0.95 ? 0.3 + Math.random() * 0.4 : 1.2;
  return at + length + gap;
}

export async function createSyntheticAnalyser(): Promise<SyntheticAnalyser> {
  const context = new AudioContext();
  await context.resume().catch(() => undefined);
  const oscillator = context.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.value = 140;
  const gain = context.createGain();
  gain.gain.value = 0;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  oscillator.connect(gain).connect(analyser);
  oscillator.start();

  let cursor = context.currentTime + 0.05;
  const schedule = () => {
    while (cursor < context.currentTime + SCHEDULE_AHEAD_SEC) cursor = nextSyllable(gain, cursor);
  };
  schedule();
  const timer = window.setInterval(schedule, SCHEDULER_MS);

  return {
    analyser,
    stop: () => {
      window.clearInterval(timer);
      oscillator.stop();
      void context.close();
    },
  };
}
