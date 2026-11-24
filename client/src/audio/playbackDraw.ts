import type { PaceDriftRange } from '@rehearsal/shared';
import { BAR_WIDTH, barHeight, barsForSpan, barX, layoutBars, resamplePeaksSafe, timeToX, type WaveformMark } from './geometry';
import { fillBar } from './useCanvasTokens';

/** Vertical bands of the playback canvas, in CSS px from the top (see PlaybackWaveform.module.css). */
export const PLAYBACK_LAYOUT = {
  /** Space above the bars for marker pips (drawn in the DOM, inside the marker buttons). */
  pipBand: 14,
  /** Space below the bars for the pace drift rule. */
  ruleBand: 10,
  ruleThickness: 2,
  playheadWidth: 2,
  bandAlpha: 0.16,
  selectedBandAlpha: 0.3,
} as const;

export interface PlaybackColours {
  bar: string;
  played: string;
  filler: string;
  pause: string;
  playhead: string;
}

export interface PlaybackScene {
  width: number;
  height: number;
  ratio: number;
  peaks: readonly number[];
  durationSec: number;
  currentTimeSec: number;
  marks: readonly WaveformMark[];
  paceDrift: readonly PaceDriftRange[];
  selectedMarkId: string | null;
  colours: PlaybackColours;
}

function toDevice(cssX: number, ratio: number): number {
  return Math.round(cssX * ratio);
}

function drawPauseBands(ctx: CanvasRenderingContext2D, scene: PlaybackScene, top: number, bottom: number): void {
  const layout = layoutBars(scene.width);
  ctx.fillStyle = scene.colours.pause;
  for (const mark of scene.marks) {
    if (mark.kind !== 'pause') continue;
    const left = toDevice(timeToX(layout, mark.start, scene.durationSec), scene.ratio);
    const right = toDevice(timeToX(layout, mark.end, scene.durationSec), scene.ratio);
    ctx.globalAlpha = mark.id === scene.selectedMarkId ? PLAYBACK_LAYOUT.selectedBandAlpha : PLAYBACK_LAYOUT.bandAlpha;
    ctx.beginPath();
    const r = Math.round(2 * scene.ratio);
    if (typeof ctx.roundRect === 'function') ctx.roundRect(left, top, Math.max(1, right - left), bottom - top, r);
    else ctx.rect(left, top, Math.max(1, right - left), bottom - top);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function fillerBarSet(scene: PlaybackScene): Set<number> {
  const layout = layoutBars(scene.width);
  const set = new Set<number>();
  for (const mark of scene.marks) {
    if (mark.kind !== 'filler') continue;
    for (const i of barsForSpan(layout, mark.start, mark.end, scene.durationSec)) set.add(i);
  }
  return set;
}

function drawBars(ctx: CanvasRenderingContext2D, scene: PlaybackScene, midY: number, maxH: number): void {
  const layout = layoutBars(scene.width);
  const levels = resamplePeaksSafe(scene.peaks, layout.count);
  const fillers = fillerBarSet(scene);
  const playheadX = timeToX(layout, scene.currentTimeSec, scene.durationSec);
  const barW = Math.max(1, Math.round(BAR_WIDTH * scene.ratio));
  for (let i = 0; i < layout.count; i += 1) {
    const x = barX(layout, i);
    const played = x + BAR_WIDTH / 2 <= playheadX && scene.currentTimeSec > 0;
    ctx.fillStyle = fillers.has(i) ? scene.colours.filler : played ? scene.colours.played : scene.colours.bar;
    fillBar(ctx, toDevice(x, scene.ratio), midY, barW, barHeight(levels[i] ?? 0, maxH / scene.ratio) * scene.ratio);
  }
}

function drawDriftRules(ctx: CanvasRenderingContext2D, scene: PlaybackScene): void {
  const layout = layoutBars(scene.width);
  const thickness = Math.max(1, Math.round(PLAYBACK_LAYOUT.ruleThickness * scene.ratio));
  const y = Math.round((scene.height - PLAYBACK_LAYOUT.ruleBand / 2) * scene.ratio - thickness / 2);
  ctx.fillStyle = scene.colours.pause;
  for (const range of scene.paceDrift) {
    const left = toDevice(timeToX(layout, range.start, scene.durationSec), scene.ratio);
    const right = toDevice(timeToX(layout, range.end, scene.durationSec), scene.ratio);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(left, y, Math.max(1, right - left), thickness, thickness / 2);
    else ctx.rect(left, y, Math.max(1, right - left), thickness);
    ctx.fill();
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, scene: PlaybackScene): void {
  const layout = layoutBars(scene.width);
  const w = Math.max(1, Math.round(PLAYBACK_LAYOUT.playheadWidth * scene.ratio));
  const x = toDevice(timeToX(layout, scene.currentTimeSec, scene.durationSec), scene.ratio) - Math.floor(w / 2);
  const top = Math.round((PLAYBACK_LAYOUT.pipBand / 2) * scene.ratio);
  ctx.fillStyle = scene.colours.playhead;
  ctx.fillRect(x, top, w, Math.round(scene.height * scene.ratio) - top);
}

/** Paint the whole playback scene. Cheap enough (a few hundred rects) to redraw every frame. */
export function drawPlayback(ctx: CanvasRenderingContext2D, scene: PlaybackScene): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const top = Math.round(PLAYBACK_LAYOUT.pipBand * scene.ratio);
  const bottom = Math.round((scene.height - PLAYBACK_LAYOUT.ruleBand) * scene.ratio);
  drawPauseBands(ctx, scene, top, bottom);
  drawBars(ctx, scene, (top + bottom) / 2, bottom - top);
  drawDriftRules(ctx, scene);
  drawPlayhead(ctx, scene);
}
