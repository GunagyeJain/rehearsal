import { useCallback, useRef } from 'react';
import { useAuth } from '../../../auth/authContext';
import { patchSettings } from '../../../auth/authApi';

/**
 * The live screen's conversation toggle, stored in the account as settings.showTranscript.
 * Applied optimistically; only the newest PATCH may write back, and a failed save reverts it.
 */
export function useShowTranscript(): [boolean, () => void] {
  const { user, updateUser } = useAuth();
  const latestRequest = useRef(0);
  const showTranscript = user?.settings.showTranscript ?? true;

  const toggle = useCallback(() => {
    const next = !showTranscript;
    latestRequest.current += 1;
    const requestId = latestRequest.current;
    const apply = (value: boolean) => updateUser((u) => ({ ...u, settings: { ...u.settings, showTranscript: value } }));
    apply(next);
    patchSettings({ showTranscript: next })
      .then(({ settings }) => {
        if (requestId === latestRequest.current) apply(settings.showTranscript);
      })
      .catch(() => {
        if (requestId === latestRequest.current) apply(!next);
      });
  }, [showTranscript, updateUser]);

  return [showTranscript, toggle];
}
