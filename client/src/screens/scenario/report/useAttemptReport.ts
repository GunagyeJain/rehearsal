import { useCallback, useEffect, useState } from 'react';
import type { AttemptDetailResponse } from '@rehearsal/shared';
import { isApiError } from '../../../api/client';
import { getAttempt } from '../scenarioApi';

export const REPORT_POLL_MS = 1000;
/**
 * Longer than the judge's worst case (two 60 s tries, server/src/services/claude.ts) and the server's
 * STALE_SCORING_MS (60 s), so polling alone lets a stuck attempt be re-judged before the client gives up.
 */
export const REPORT_POLL_GIVE_UP_MS = 130_000;

export interface AttemptReportState {
  detail: AttemptDetailResponse | null;
  /** First load failed (no report to show). */
  error: { notFound: boolean; message: string } | null;
  /** Polling stopped after REPORT_POLL_GIVE_UP_MS while still scoring. */
  timedOut: boolean;
  retry: () => void;
}

/** GET /api/attempts/:id, polled every second while the judge runs (spec/api.md latency strategy). */
export function useAttemptReport(attemptId: string): AttemptReportState {
  const [detail, setDetail] = useState<AttemptDetailResponse | null>(null);
  const [error, setError] = useState<AttemptReportState['error']>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer = 0;

    const poll = async () => {
      try {
        const next = await getAttempt(attemptId, controller.signal);
        if (controller.signal.aborted) return;
        setDetail(next);
        setError(null);
        if (next.attempt.status !== 'scoring') return;
        if (Date.now() - startedAt >= REPORT_POLL_GIVE_UP_MS) {
          setTimedOut(true);
          return;
        }
        timer = window.setTimeout(() => void poll(), REPORT_POLL_MS);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const notFound = isApiError(err) && err.code === 'NOT_FOUND';
        const message = isApiError(err) ? err.message : 'The report did not load. Check your connection and retry.';
        setError({ notFound, message });
      }
    };
    void poll();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [attemptId, round]);

  const retry = useCallback(() => {
    setTimedOut(false);
    setError(null);
    setRound((r) => r + 1);
  }, []);

  return { detail, error, timedOut, retry };
}
