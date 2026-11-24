import { describe, expect, it } from 'vitest';
import { INITIAL_SILENCE_STATE, rmsOf, stepSilence, type SilenceConfig, type SilenceState } from './silence';

const config: SilenceConfig = {
  silenceStopSeconds: 2,
  minSeconds: 5,
  speechRms: 0.02,
  silenceRms: 0.01,
  speechConfirmSeconds: 0.2,
};

const SPEECH = 0.1;
const QUIET = 0.001;
const DT = 0.05;

/** Feed `rms` from `from` to `to` seconds at 20Hz. */
function run(state: SilenceState, rms: number, from: number, to: number): SilenceState {
  let s = state;
  for (let t = from; t <= to + 1e-9; t += DT) s = stepSilence(s, rms, Number(t.toFixed(3)), config);
  return s;
}

describe('stepSilence', () => {
  it('never stops on silence before any speech', () => {
    const s = run(INITIAL_SILENCE_STATE, QUIET, 0, 30);
    expect(s.phase).toBe('waiting');
    expect(s.speechDetected).toBe(false);
    expect(s.shouldStop).toBe(false);
  });

  it('ignores a click shorter than the confirm window', () => {
    let s = run(INITIAL_SILENCE_STATE, SPEECH, 0, 0.1);
    s = run(s, QUIET, 0.15, 10);
    expect(s.speechDetected).toBe(false);
    expect(s.shouldStop).toBe(false);
  });

  it('arms after sustained speech and stops after the silence window once past minSeconds', () => {
    let s = run(INITIAL_SILENCE_STATE, SPEECH, 0, 6);
    expect(s.phase).toBe('speaking');
    s = run(s, QUIET, 6.05, 7.9);
    expect(s.phase).toBe('silent');
    expect(s.shouldStop).toBe(false);
    s = run(s, QUIET, 7.95, 8.1);
    expect(s.shouldStop).toBe(true);
  });

  it('does not stop before minSeconds even after a long silence', () => {
    let s = run(INITIAL_SILENCE_STATE, SPEECH, 0, 0.5);
    s = run(s, QUIET, 0.55, 4.9);
    expect(s.shouldStop).toBe(false);
    s = run(s, QUIET, 4.95, 5.05);
    expect(s.shouldStop).toBe(true);
  });

  it('resets the silence run when speech resumes', () => {
    let s = run(INITIAL_SILENCE_STATE, SPEECH, 0, 6);
    s = run(s, QUIET, 6.05, 7.5);
    s = run(s, SPEECH, 7.55, 8);
    expect(s.phase).toBe('speaking');
    expect(s.silentSince).toBeNull();
    s = run(s, QUIET, 8.05, 9.5);
    expect(s.shouldStop).toBe(false);
  });

  it('uses hysteresis: a level between the floors keeps speaking', () => {
    let s = run(INITIAL_SILENCE_STATE, SPEECH, 0, 6);
    s = run(s, 0.015, 6.05, 20);
    expect(s.phase).toBe('speaking');
    expect(s.shouldStop).toBe(false);
  });

  it('a level between the floors does not arm the detector', () => {
    const s = run(INITIAL_SILENCE_STATE, 0.015, 0, 3);
    expect(s.speechDetected).toBe(false);
  });

  it('stays stopped once stopped', () => {
    const stopped: SilenceState = { ...INITIAL_SILENCE_STATE, shouldStop: true };
    expect(stepSilence(stopped, SPEECH, 1, config)).toBe(stopped);
  });
});

describe('rmsOf', () => {
  it('is 0 for empty and silent input', () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([0, 0, 0])).toBe(0);
  });

  it('is the amplitude for a square wave', () => {
    expect(rmsOf([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });
});
