import { DEFAULT_SETTINGS, type FontSetting, type ThemeSetting } from '@rehearsal/shared';

/** Appearance as stored locally. Later phases also sync this to user settings via the API. */
export interface Appearance {
  theme: ThemeSetting;
  font: FontSetting;
}

export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'rehearsal.appearance';

export const THEME_OPTIONS: readonly { value: ThemeSetting; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export const FONT_OPTIONS: readonly { value: FontSetting; label: string }[] = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
  { value: 'mono', label: 'Mono' },
];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_SETTINGS.theme,
  font: DEFAULT_SETTINGS.font,
};

function isTheme(value: unknown): value is ThemeSetting {
  return THEME_OPTIONS.some((option) => option.value === value);
}

function isFont(value: unknown): value is FontSetting {
  return FONT_OPTIONS.some((option) => option.value === value);
}

/** Reads stored appearance. Storage can be missing or blocked, so every access is guarded. */
export function readStoredAppearance(): Appearance {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_APPEARANCE;
    const record = parsed as Record<string, unknown>;
    return {
      theme: isTheme(record.theme) ? record.theme : DEFAULT_APPEARANCE.theme,
      font: isFont(record.font) ? record.font : DEFAULT_APPEARANCE.font,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeStoredAppearance(appearance: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage blocked (private mode, quota). Appearance still applies for this session.
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function resolveTheme(theme: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/** Applies attributes to <html> and syncs the browser chrome colour to the active --bg token. */
export function applyAppearance(root: HTMLElement, appearance: Appearance, resolved: ResolvedTheme): void {
  root.dataset.theme = appearance.theme;
  root.dataset.font = appearance.font;
  root.dataset.resolvedTheme = resolved;

  // index.html ships one theme-color per prefers-color-scheme for first paint. Once the theme is
  // known (and possibly overriding the system), every one of them takes the active --bg.
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) return;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (!bg) return;
  metas.forEach((meta) => {
    meta.content = bg;
  });
}
