import { useCallback, useEffect, useState } from 'react';
import { isApiError } from './client';

export type RemoteLoad<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

const FALLBACK_MESSAGE = 'Could not load this. Check your connection and retry.';

interface Remote<T> {
  load: RemoteLoad<T>;
  /** Show the loading state and fetch again (after an error). */
  reload: () => void;
  /** Fetch again in the background, keeping the current data on screen. */
  refresh: () => void;
  /** Replace the loaded data locally after a successful change. */
  setData: (update: (data: T) => T) => void;
}

/** Loads one resource on mount. `fetcher` must be stable (a module function or memoised); aborts on unmount so a late response never lands on a gone screen. */
export function useRemote<T>(fetcher: (signal: AbortSignal) => Promise<T>): Remote<T> {
  const [load, setLoad] = useState<RemoteLoad<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad((current) =>
          current.status === 'ready' ? current : { status: 'error', message: isApiError(error) ? error.message : FALLBACK_MESSAGE },
        );
      });
    return () => controller.abort();
  }, [fetcher, nonce]);

  const reload = useCallback(() => {
    setLoad({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const setData = useCallback((update: (data: T) => T) => {
    setLoad((current) => (current.status === 'ready' ? { status: 'ready', data: update(current.data) } : current));
  }, []);

  return { load, reload, refresh, setData };
}
