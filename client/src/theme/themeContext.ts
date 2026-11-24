import { createContext, useContext } from 'react';
import type { FontSetting, ThemeSetting } from '@rehearsal/shared';
import type { Appearance, ResolvedTheme } from './appearance';

export interface ThemeContextValue {
  theme: ThemeSetting;
  font: FontSetting;
  /** The theme actually on screen once 'system' is resolved. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeSetting) => void;
  setFont: (font: FontSetting) => void;
  /** Apply appearance from elsewhere (the signed-in user's settings) without reporting it as a user change. */
  replaceAppearance: (appearance: Partial<Appearance>) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
