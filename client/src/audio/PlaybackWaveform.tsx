import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { FillerMark, PaceDriftRange, PauseMark } from '@rehearsal/shared';
import { cx } from '../components/cx';
import { buildWaveformMarks, describeDrift, formatClock, layoutBars, timeToX, xToTime, type WaveformMark } from './geometry';
import { drawPlayback, type PlaybackColours } from './playbackDraw';
import { fitCanvas, useCanvasTokens, useElementSize } from './useCanvasTokens';
import styles from './PlaybackWaveform.module.css';

const TOKENS = ['--text-faint', '--text-muted', '--fail', '--warn', '--text'] as const;
const STEP_SEC = 1;
const STEP_LARGE_SEC = 5;
const PAGE_SEC = 10;
const NO_FILLERS: readonly FillerMark[] = [];
const NO_PAUSES: readonly PauseMark[] = [];
const NO_DRIFT: readonly PaceDriftRange[] = [];

export interface PlaybackWaveformProps {
  /** Normalised envelope (0..1), any length; fitted to the bar count. */
  peaks: readonly number[];
  durationSec: number;
  currentTimeSec: number;
  /** Marks for this waveform's turn only (see marksForTurn). */
  fillerMarks?: readonly FillerMark[];
  pauseMarks?: readonly PauseMark[];
  paceDrift?: readonly PaceDriftRange[];
  onSeek: (sec: number) => void;
  /** Called after a marker seeks to its start; use it to highlight the word in the transcript. */
  onMarkerSelect?: (mark: WaveformMark) => void;
  selectedMarkId?: string | null;
  /** Accessible name for the scrubber, e.g. "Turn 1 recording". */
  label?: string;
  className?: string;
}

function keyTarget(event: KeyboardEvent, durationSec: number, current: number): number | null {
  const step = event.shiftKey ? STEP_LARGE_SEC : STEP_SEC;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return current - step;
    case 'ArrowRight':
    case 'ArrowUp':
      return current + step;
    case 'PageDown':
      return current - PAGE_SEC;
    case 'PageUp':
      return current + PAGE_SEC;
    case 'Home':
      return 0;
    case 'End':
      return durationSec;
    default:
      return null;
  }
}

function summarise(fillers: number, pauses: number, drift: readonly PaceDriftRange[]): string {
  const parts = [
    `${fillers} ${fillers === 1 ? 'filler' : 'fillers'}`,
    `${pauses} long ${pauses === 1 ? 'pause' : 'pauses'}`,
    ...drift.map(describeDrift),
  ];
  return `${parts.join(', ')}.`;
}

function Legend({ fillers, pauses, drift }: { fillers: number; pauses: number; drift: number }) {
  return (
    <ul className={styles.legend} aria-label="Waveform key">
      <li className={styles.legendItem}>
        <span className={cx(styles.glyph, styles.glyphFiller)} aria-hidden="true" />
        Filler
        <span className={styles.count}>{fillers}</span>
      </li>
      <li className={styles.legendItem}>
        <span className={cx(styles.glyph, styles.glyphPause)} aria-hidden="true" />
        Pause over 2s
        <span className={styles.count}>{pauses}</span>
      </li>
      <li className={styles.legendItem}>
        <span className={cx(styles.glyph, styles.glyphDrift)} aria-hidden="true" />
        Pace off target
        <span className={styles.count}>{drift}</span>
      </li>
    </ul>
  );
}

function useScrub(width: number, durationSec: number, onSeek: (sec: number) => void) {
  const layout = useMemo(() => layoutBars(width), [width]);
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(xToTime(layout, event.clientX - rect.left, durationSec));
  };
  return {
    layout,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
      seekAt(event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event);
    },
  };
}

/**
 * The report's waveform: static bars for one turn with filler, pause and pace overlays, a
 * playhead and a scrubber. Markers are real buttons with 44px hit areas; the legend pairs every
 * colour with a shape and a label so colour is never the only signal.
 */
export function PlaybackWaveform({
  peaks,
  durationSec,
  currentTimeSec,
  fillerMarks = NO_FILLERS,
  pauseMarks = NO_PAUSES,
  paceDrift = NO_DRIFT,
  onSeek,
  onMarkerSelect,
  selectedMarkId = null,
  label = 'Recording',
  className,
}: PlaybackWaveformProps) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const summaryId = useId();
  const { width, height } = useElementSize(stage);
  const tokens = useCanvasTokens(TOKENS);
  const marks = useMemo(() => buildWaveformMarks(fillerMarks, pauseMarks), [fillerMarks, pauseMarks]);
  const scrub = useScrub(width, durationSec, onSeek);
  const current = Math.min(Math.max(0, currentTimeSec), Math.max(0, durationSec));
  const fillerCount = marks.filter((m) => m.kind === 'filler').length;
  const pauseCount = marks.length - fillerCount;

  const colours = useMemo<PlaybackColours>(
    () => ({
      bar: tokens['--text-faint'],
      played: tokens['--text-muted'],
      filler: tokens['--fail'],
      pause: tokens['--warn'],
      playhead: tokens['--text'],
    }),
    [tokens],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || width === 0 || height === 0) return;
    const ratio = fitCanvas(canvas, width, height);
    drawPlayback(ctx, {
      width,
      height,
      ratio,
      peaks,
      durationSec,
      currentTimeSec: current,
      marks,
      paceDrift,
      selectedMarkId,
      colours,
    });
  }, [width, height, peaks, durationSec, current, marks, paceDrift, selectedMarkId, colours]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyTarget(event, durationSec, current);
    if (next === null) return;
    event.preventDefault();
    onSeek(Math.min(Math.max(0, next), durationSec));
  };

  const selectMark = (mark: WaveformMark) => {
    onSeek(mark.start);
    onMarkerSelect?.(mark);
  };

  return (
    <div className={cx(styles.root, className)}>
      <div ref={setStage} className={styles.stage}>
        <div
          className={styles.scrubber}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatClock(current)} of ${formatClock(durationSec)}`}
          aria-describedby={summaryId}
          onKeyDown={onKeyDown}
          onPointerDown={scrub.onPointerDown}
          onPointerMove={scrub.onPointerMove}
        >
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        </div>
        <div className={styles.markers}>
          {width > 0 &&
            marks.map((mark) => (
              <button
                key={mark.id}
                type="button"
                className={cx(styles.marker, mark.kind === 'pause' ? styles.markerPause : styles.markerFiller)}
                style={{ left: `${timeToX(scrub.layout, (mark.start + mark.end) / 2, durationSec)}px` }}
                aria-label={mark.label}
                aria-pressed={mark.id === selectedMarkId}
                onClick={() => selectMark(mark)}
              >
                <span className={styles.pip} aria-hidden="true" />
              </button>
            ))}
        </div>
      </div>
      <p id={summaryId} className="visually-hidden">
        {summarise(fillerCount, pauseCount, paceDrift)}
      </p>
      <div className={styles.meta}>
        <span className={styles.time}>
          <span className={styles.timeCurrent}>{formatClock(current)}</span>
          <span className={styles.timeSep} aria-hidden="true">
            /
          </span>
          <span>{formatClock(durationSec)}</span>
        </span>
        <Legend fillers={fillerCount} pauses={pauseCount} drift={paceDrift.length} />
      </div>
    </div>
  );
}
