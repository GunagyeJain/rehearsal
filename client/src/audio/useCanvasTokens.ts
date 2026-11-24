import { useContext, useEffect, useState } from 'react';
import { ThemeContext } from '../theme/themeContext';

/**
 * Canvas cannot read CSS variables, so colour tokens are resolved from the root element and
 * re-read whenever the resolved theme changes. Read from context directly (not useTheme) so a
 * waveform rendered outside the provider, as in tests, still works with the light defaults.
 */
export function readTokens<K extends string>(names: readonly K[]): Record<K, string> {
  const style = getComputedStyle(document.documentElement);
  const out = {} as Record<K, string>;
  for (const name of names) out[name] = style.getPropertyValue(name).trim();
  return out;
}

export function useCanvasTokens<K extends string>(names: readonly K[]): Record<K, string> {
  const resolvedTheme = useContext(ThemeContext)?.resolvedTheme ?? null;
  const key = names.join('|');
  const [tokens, setTokens] = useState<Record<K, string>>(() => readTokens(names));

  useEffect(() => {
    // The theme attribute is applied in an effect too; wait a frame so the new values are live.
    const frame = requestAnimationFrame(() => setTokens(readTokens(key.split('|') as K[])));
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme, key]);

  return tokens;
}

/** Device pixel ratio, clamped: beyond 3x the extra pixels cost fill rate and are invisible. */
export function canvasPixelRatio(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

/** Size a canvas backing store to its CSS box at the device pixel ratio. Returns the ratio used. */
export function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): number {
  const ratio = canvasPixelRatio();
  const w = Math.max(1, Math.round(cssWidth * ratio));
  const h = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return ratio;
}

/** Observe an element's content box and report its CSS pixel size. */
export function useElementSize(element: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height },
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * Fill a vertical bar centred on `midY`, in device pixels. Edges are snapped to whole device
 * pixels so bars stay crisp at any devicePixelRatio; caps are rounded where supported.
 */
export function fillBar(ctx: CanvasRenderingContext2D, x: number, midY: number, width: number, height: number): void {
  const h = Math.max(1, Math.round(height));
  const top = Math.round(midY - h / 2);
  if (typeof ctx.roundRect === 'function' && h > width) {
    ctx.beginPath();
    ctx.roundRect(x, top, width, h, width / 2);
    ctx.fill();
  } else {
    ctx.fillRect(x, top, width, h);
  }
}
