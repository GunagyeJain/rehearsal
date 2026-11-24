/**
 * Per-account sign-in throttle (spec/api.md "Rate limits"). The per-IP limiter stops one client;
 * this stops a distributed guess at one account. In memory: a restart clears it, which is acceptable
 * for a single-process server.
 */

const MINUTE_MS = 60_000;
export const SIGNIN_FAILURE_WINDOW_MS = 15 * MINUTE_MS;
export const SIGNIN_FAILURE_LIMIT = 10;
/** Prune expired entries once the map grows past this, so it cannot grow without bound. */
const PRUNE_THRESHOLD = 10_000;

interface FailureWindow {
  count: number;
  startedAt: number;
}

export interface SigninThrottle {
  /** True when this email has used up its failures for the current window. */
  isLocked(email: string, now?: number): boolean;
  recordFailure(email: string, now?: number): void;
  recordSuccess(email: string): void;
}

export function createSigninThrottle(
  limit = SIGNIN_FAILURE_LIMIT,
  windowMs = SIGNIN_FAILURE_WINDOW_MS,
): SigninThrottle {
  const failures = new Map<string, FailureWindow>();

  const active = (email: string, now: number): FailureWindow | null => {
    const entry = failures.get(email);
    if (!entry) return null;
    if (now - entry.startedAt >= windowMs) {
      failures.delete(email);
      return null;
    }
    return entry;
  };

  const prune = (now: number): void => {
    if (failures.size < PRUNE_THRESHOLD) return;
    for (const [email, entry] of failures) {
      if (now - entry.startedAt >= windowMs) failures.delete(email);
    }
  };

  return {
    isLocked(email, now = Date.now()) {
      const entry = active(email, now);
      return entry !== null && entry.count >= limit;
    },
    recordFailure(email, now = Date.now()) {
      prune(now);
      const entry = active(email, now);
      failures.set(email, entry ? { count: entry.count + 1, startedAt: entry.startedAt } : { count: 1, startedAt: now });
    },
    recordSuccess(email) {
      failures.delete(email);
    },
  };
}
