import { useCallback, useEffect, useState } from 'react';
import type { ScenarioDetailResponse } from '@rehearsal/shared';
import { isApiError } from '../../api/client';
import { getScenario } from './scenarioApi';

export type ScenarioLoad =
  | { status: 'loading' }
  | { status: 'error'; notFound: boolean; message: string }
  | { status: 'ready'; data: ScenarioDetailResponse };

/** Loads one scenario; `reload` retries after an error. */
export function useScenario(scenarioId: string): { load: ScenarioLoad; reload: () => void } {
  const [load, setLoad] = useState<ScenarioLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getScenario(scenarioId, controller.signal)
      .then((data) => setLoad({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const notFound = isApiError(error) && error.code === 'NOT_FOUND';
        const message = isApiError(error) ? error.message : 'The scenario did not load. Check your connection and retry.';
        setLoad({ status: 'error', notFound, message });
      });
    return () => controller.abort();
  }, [scenarioId, nonce]);

  const reload = useCallback(() => {
    setLoad({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  return { load, reload };
}
