import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play, Square } from 'lucide-react';
import type { FillerMark, PaceDriftRange, PauseMark } from '@rehearsal/shared';
import { Button, SegmentedControl } from '../../components';
import {
  createSyntheticAnalyser,
  LiveWaveform,
  marksForTurn,
  PlaybackWaveform,
  type SyntheticAnalyser,
  type WaveformMark,
} from '../../audio';
import styles from './DesignScreen.module.css';

const PEAKS_PER_SECOND = 20;

interface DemoTurn {
  durationSec: number;
  silences: readonly (readonly [number, number])[];
}

const TURNS: readonly DemoTurn[] = [
  { durationSec: 46, silences: [[0, 0.4], [14.2, 17.6], [31.1, 33.4], [45.2, 46]] },
  { durationSec: 28, silences: [[0, 0.3], [9.4, 12.1], [27.4, 28]] },
];

const FILLERS: readonly FillerMark[] = [
  { word: 'um', start: 4.1, end: 4.45, turnIndex: 0, wordIndex: 9, wordCount: 1 },
  { word: 'uh', start: 12.3, end: 12.55, turnIndex: 0, wordIndex: 31, wordCount: 1 },
  { word: 'like', start: 22.8, end: 23.1, turnIndex: 0, wordIndex: 58, wordCount: 1 },
  { word: 'you know', start: 38.5, end: 39.1, turnIndex: 0, wordIndex: 97, wordCount: 2 },
  { word: 'so', start: 2.2, end: 2.45, turnIndex: 1, wordIndex: 4, wordCount: 1 },
  { word: 'um', start: 19.6, end: 20, turnIndex: 1, wordIndex: 47, wordCount: 1 },
];

const PAUSES: readonly PauseMark[] = [
  { start: 14.2, end: 17.6, durationSec: 3.4, turnIndex: 0, afterWordIndex: 36 },
  { start: 31.1, end: 33.4, durationSec: 2.3, turnIndex: 0, afterWordIndex: 79 },
  { start: 9.4, end: 12.1, durationSec: 2.7, turnIndex: 1, afterWordIndex: 22 },
];

const DRIFT: readonly PaceDriftRange[] = [
  { turnIndex: 0, start: 20, end: 30, direction: 'fast' },
  { turnIndex: 1, start: 12.1, end: 22.1, direction: 'slow' },
];

/** Deterministic speech-like envelope: syllable bumps inside phrases, silence in the gaps. */
function syntheticPeaks(turn: DemoTurn, seed: number): number[] {
  const count = Math.round(turn.durationSec * PEAKS_PER_SECOND);
  return Array.from({ length: count }, (_, i) => {
    const t = i / PEAKS_PER_SECOND;
    if (turn.silences.some(([a, b]) => t >= a && t < b)) return 0.02 * Math.abs(Math.sin(i * 7.1 + seed));
    const syllable = Math.pow(Math.abs(Math.sin(t * 7.3 + seed)), 2.4);
    const word = Math.pow(Math.abs(Math.sin(t * 2.1 + seed * 3)), 0.8);
    const phrase = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.45 + seed * 2));
    const grain = 0.75 + 0.25 * Math.abs(Math.sin(i * 12.9898 + seed * 78.233));
    return Math.min(1, 0.04 + syllable * word * phrase * grain);
  });
}

const PEAKS = TURNS.map((turn, i) => syntheticPeaks(turn, i + 1));
const TURN_OPTIONS = TURNS.map((_, i) => ({ value: String(i), label: `Turn ${i + 1}` }));

function LiveDemo() {
  const [source, setSource] = useState<SyntheticAnalyser | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => () => source?.stop(), [source]);

  async function toggle() {
    if (source) return setSource(null);
    setStarting(true);
    try {
      setSource(await createSyntheticAnalyser());
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className={styles.waveDemo}>
      <div className={styles.waveDemoHead}>
        <span className={styles.rowLabel}>Live</span>
        <Button size="sm" variant="secondary" icon={source ? Square : Mic} loading={starting} onClick={toggle}>
          {source ? 'Stop synthetic input' : 'Start synthetic input'}
        </Button>
      </div>
      <LiveWaveform analyser={source?.analyser ?? null} active={source !== null} label="Synthetic input level" />
    </div>
  );
}

function usePlaybackClock(durationSec: number) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setCurrent((c) => {
        const next = c + dt;
        if (next >= durationSec) setPlaying(false);
        return Math.min(next, durationSec);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, durationSec]);

  const toggle = () => {
    if (!playing && current >= durationSec) setCurrent(0);
    setPlaying((p) => !p);
  };
  return { current, setCurrent, playing, toggle };
}

function PlaybackDemo() {
  const [turn, setTurn] = useState('0');
  const index = Number(turn);
  const data = TURNS[index] ?? TURNS[0];
  const durationSec = data?.durationSec ?? 0;
  const clock = usePlaybackClock(durationSec);
  const [selected, setSelected] = useState<WaveformMark | null>(null);
  const marks = useMemo(
    () => ({
      fillers: marksForTurn(FILLERS, index),
      pauses: marksForTurn(PAUSES, index),
      drift: marksForTurn(DRIFT, index),
    }),
    [index],
  );

  const changeTurn = (value: string) => {
    setTurn(value);
    setSelected(null);
    clock.setCurrent(0);
  };

  return (
    <div className={styles.waveDemo}>
      <div className={styles.waveDemoHead}>
        <span className={styles.rowLabel}>Playback</span>
        <SegmentedControl legend="Turn" hideLegend options={TURN_OPTIONS} value={turn} onChange={changeTurn} />
        <Button size="sm" variant="secondary" icon={clock.playing ? Pause : Play} onClick={clock.toggle}>
          {clock.playing ? 'Pause' : 'Play'}
        </Button>
      </div>
      <PlaybackWaveform
        peaks={PEAKS[index] ?? []}
        durationSec={durationSec}
        currentTimeSec={clock.current}
        fillerMarks={marks.fillers}
        pauseMarks={marks.pauses}
        paceDrift={marks.drift}
        onSeek={clock.setCurrent}
        onMarkerSelect={setSelected}
        selectedMarkId={selected?.id ?? null}
        label={`Turn ${index + 1} recording`}
      />
      <p className={styles.caption} aria-live="polite">
        {selected ? `Selected ${selected.label}, word ${selected.wordIndex}.` : 'Select a marker to jump to it.'}
      </p>
    </div>
  );
}

/** Both waveforms on synthetic data, for reviewing the rendering in each theme. */
export function WaveformDemo() {
  return (
    <div className={styles.stack}>
      <LiveDemo />
      <PlaybackDemo />
    </div>
  );
}
