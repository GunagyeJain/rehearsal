import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { useTheme } from '../theme/themeContext';
import type { Appearance } from '../theme/appearance';
import { patchSettings } from './authApi';
import { useAuth } from './authContext';

/** Applies the signed-in user's saved theme and font whenever the account or its saved values change. */
function SeedFromAccount() {
  const { user } = useAuth();
  const { replaceAppearance } = useTheme();
  const userId = user?.id ?? null;
  const theme = user?.settings.theme;
  const font = user?.settings.font;

  useEffect(() => {
    if (userId && theme && font) replaceAppearance({ theme, font });
  }, [userId, theme, font, replaceAppearance]);

  return null;
}

interface AccountThemeProviderProps {
  children: ReactNode;
}

/**
 * ThemeProvider wired to the account: seeded from user.settings after sign-in, and every theme or
 * font change made while signed in is PATCHed to /api/users/me/settings. Signed out, appearance
 * stays local to the device.
 */
export function AccountThemeProvider({ children }: AccountThemeProviderProps) {
  const { status, updateUser } = useAuth();
  const signedIn = status === 'signed-in';
  // Only the newest PATCH may write back, so out-of-order responses never revert a later choice.
  const latestRequest = useRef(0);

  const saveToAccount = useCallback(
    (patch: Partial<Appearance>) => {
      if (!signedIn) return;
      latestRequest.current += 1;
      const requestId = latestRequest.current;
      patchSettings(patch)
        .then(({ settings }) => {
          // Write back only theme and font, so a showTranscript change made meanwhile is kept.
          if (requestId === latestRequest.current) {
            updateUser((user) => ({
              ...user,
              settings: { ...user.settings, theme: settings.theme, font: settings.font },
            }));
          }
        })
        .catch(() => {
          // The change still applies on this device; the next change retries the save.
        });
    },
    [signedIn, updateUser],
  );

  return (
    <ThemeProvider onUserChange={saveToAccount}>
      <SeedFromAccount />
      {children}
    </ThemeProvider>
  );
}
