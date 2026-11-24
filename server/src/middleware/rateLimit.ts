import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request } from 'express';
import type { ApiErrorBody } from '@rehearsal/shared';

const MINUTE_MS = 60_000;

export interface RateLimitConfig {
  windowMs: number;
  limit: number;
}

/** spec/api.md: auth routes 20 requests per 15 minutes per IP. */
export const AUTH_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * MINUTE_MS, limit: 20 };
/** spec/api.md: /api/tts and turn generation 60 per 5 minutes per user. */
export const GENERATION_RATE_LIMIT: RateLimitConfig = { windowMs: 5 * MINUTE_MS, limit: 60 };
/** spec/api.md: /api/tts at most 150 per day per user, so one account cannot spend the daily Groq TTS quota. */
export const TTS_DAILY_RATE_LIMIT: RateLimitConfig = { windowMs: 24 * 60 * MINUTE_MS, limit: 150 };
/** spec/api.md: uploads 30 per 5 minutes per user. */
export const UPLOAD_RATE_LIMIT: RateLimitConfig = { windowMs: 5 * MINUTE_MS, limit: 30 };

/** Key per authenticated user. Must run after requireUser. */
export function userRateLimitKey(req: Request): string {
  return req.userId ? `user:${req.userId.toHexString()}` : 'anonymous';
}

export function createRateLimiter(
  opts: RateLimitConfig & { keyGenerator?: (req: Request) => string },
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a few minutes and try again.' },
      };
      res.status(429).json(body);
    },
  });
}
