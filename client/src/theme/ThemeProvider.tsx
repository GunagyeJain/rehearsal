import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { FontSetting, ThemeSetting } from '@rehearsal/shared';
import {
  applyAppearance,
  readStoredAppearance,
  resolveTheme,
  subscribeToSystemTheme,
  systemPrefersDark,
  writeStoredAppearance,
  type Appearance,
} from './appearance';
import { ThemeContext, type ThemeContextValue } from './themeContext';

interface ThemeProviderProps {
  children: ReactNode;
  /** Overrides stored appearance, mainly for tests and the design route. */
  initial?: Partial<Appearance>;
  /** Called after the user changes theme or font (not after replaceAppearance), e.g. to save it to the account. */
  onUserChange?: (patch: Partial<Appearance>) => void;
}

export function ThemeProvider({ children, initial, onUserChange }: ThemeProviderProps) {
  const [appearance, setAppearance] = useState<Appearance>(() => ({ ...readStoredAppearance(), ...initial }));
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
  const resolvedTheme = resolveTheme(appearance.theme, prefersDark);

  useLayoutEffect(() => {
    applyAppearance(document.documentElement, appearance, resolvedTheme);
  }, [appearance, resolvedTheme]);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((current) => {
      const next = { ...current, ...patch };
      writeStoredAppearance(next);
      return next;
    });
  }, []);

  const setTheme = useCallback(
    (theme: ThemeSetting) => {
      update({ theme });
      onUserChange?.({ theme });
    },
    [update, onUserChange],
  );
  const setFont = useCallback(
    (font: FontSetting) => {
      update({ font });
      onUserChange?.({ font });
    },
    [update, onUserChange],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: appearance.theme,
      font: appearance.font,
      resolvedTheme,
      setTheme,
      setFont,
      replaceAppearance: update,
    }),
    [appearance, resolvedTheme, setTheme, setFont, update],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
