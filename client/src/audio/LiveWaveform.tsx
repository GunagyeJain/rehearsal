import { useEffect, useRef, useState } from 'react';
import { cx } from '../components/cx';
import { amplitudeToLevel, BAR_PITCH, BAR_WIDTH, barHeight } from './geometry';
import { rmsOf } from './silence';
import { fillBar, fitCanvas, useCanvasTokens, useElementSize } from './useCanvasTokens';
import styles from './LiveWaveform.module.css';

/** One new bar every 50ms: the strip scrolls at BAR_PITCH * 20 = 100 CSS px per second. */
const BAR_PERIOD_MS = 50;
/** Bars fade in over this many CSS px at the left edge, so history trails off instead of clipping. */
const FADE_PX = 96;
const INACTIVE_ALPHA = 0.45;
const VERTICAL_INSET_PX = 4;
const TOKENS = ['--speaker-user'] as const;

interface LiveWaveformProps {
  analyser: AnalyserNode | null;
  /** True while recording. Inactive freezes the strip and dims it. */
  active: boolean;
  label?: string;
  className?: string;
}

interface StripState {
  levels: number[];
  pending: number;
  periodStart: number;
}

interface DrawInput {
  ctx: CanvasRenderingContext2D;
  ratio: number;
  width: number;
  height: number;
  colour: string;
  strip: StripState;
  phase: number;
  active: boolean;
}

/** Draw newest-right bars. phase (0..1) is how far through the current bar period the strip has scrolled. */
function drawStrip({ ctx, ratio, width, height, colour, strip, phase, active }: DrawInput): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = colour;
  const barW = Math.max(1, Math.round(BAR_WIDTH * ratio));
  const midY = (height * ratio) / 2;
  const maxH = (height - VERTICAL_INSET_PX * 2) * ratio;
  const offset = Math.round(phase * BAR_PITCH * ratio);
  const fade = Math.min(FADE_PX, width * 0.25);
  const baseAlpha = active ? 1 : INACTIVE_ALPHA;
  const slots = Math.ceil(width / BAR_PITCH) + 1;

  const draw = (cssX: number, level: number) => {
    const x = Math.round(cssX * ratio) - offset;
    const visibleX = x / ratio;
    if (visibleX + BAR_WIDTH < 0 || visibleX > width) return;
    ctx.globalAlpha = baseAlpha * Math.min(1, Math.max(0, visibleX / fade));
    fillBar(ctx, x, midY, barW, barHeight(level, maxH / ratio) * ratio);
  };

  // The bar still filling slides in from the right edge.
  if (active) draw(width, strip.pending);
  for (let m = 0; m < slots; m += 1) {
    const level = strip.levels[strip.levels.length - 1 - m] ?? 0;
    draw(width - BAR_PITCH * (m + 1), level);
  }
  ctx.globalAlpha = 1;
}

/**
 * The live amplitude strip: bars scroll right to left at 60fps from the analyser's RMS level.
 * Amplitude only, never coloured by performance. It keeps moving under reduced motion because
 * it is information, not decoration (spec/design.md "Motion").
 */
export function LiveWaveform({ analyser, active, label = 'Microphone level', className }: LiveWaveformProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stripRef = useRef<StripState>({ levels: [], pending: 0, periodStart: 0 });
  const { width, height } = useElementSize(root);
  const tokens = useCanvasTokens(TOKENS);
  const colour = tokens['--speaker-user'];

  // A new analyser means a new recording: start from a flat line.
  useEffect(() => {
    stripRef.current = { levels: [], pending: 0, periodStart: 0 };
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || width === 0 || height === 0) return;
    const ratio = fitCanvas(canvas, width, height);
    const strip = stripRef.current;
    const maxBars = Math.ceil(width / BAR_PITCH) + 2;
    const render = (phase: number) => drawStrip({ ctx, ratio, width, height, colour, strip, phase, active });

    if (!active) {
      render(0);
      return;
    }

    const samples = analyser ? new Float32Array(analyser.fftSize) : null;
    let frame = 0;
    strip.periodStart = performance.now();
    strip.pending = 0;

    const tick = (now: number) => {
      // After a stall (background tab), skip ahead rather than replaying every missed period.
      if (now - strip.periodStart > maxBars * BAR_PERIOD_MS) strip.periodStart = now;
      let level = 0;
      if (analyser && samples) {
        analyser.getFloatTimeDomainData(samples);
        level = amplitudeToLevel(rmsOf(samples));
      }
      strip.pending = Math.max(strip.pending, level);
      while (now - strip.periodStart >= BAR_PERIOD_MS) {
        strip.levels.push(strip.pending);
        if (strip.levels.length > maxBars) strip.levels.splice(0, strip.levels.length - maxBars);
        // Hold the latest level for any further periods this frame missed (slow or throttled frames).
        strip.pending = level;
        strip.periodStart += BAR_PERIOD_MS;
      }
      render((now - strip.periodStart) / BAR_PERIOD_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser, active, width, height, colour]);

  return (
    <div ref={setRoot} className={cx(styles.root, className)} role="img" aria-label={label}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </div>
  );
}
