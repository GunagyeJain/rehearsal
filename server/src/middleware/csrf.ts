import type { Request, RequestHandler } from 'express';
import { API_BASE } from '@rehearsal/shared';
import { HttpError } from '../http/HttpError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The only routes that take multipart (audio uploads). */
const MULTIPART_PATHS: readonly RegExp[] = [
  new RegExp(`^${API_BASE}/attempts/[^/]+/turns/\\d+/answer$`),
  new RegExp(`^${API_BASE}/onboarding/baseline$`),
];

function mediaType(req: Request): string | null {
  const header = req.get('content-type');
  if (!header) return null;
  return header.split(';')[0]?.trim().toLowerCase() ?? null;
}

function hasBody(req: Request): boolean {
  const length = req.get('content-length');
  return req.get('transfer-encoding') !== undefined || (length !== undefined && length !== '0');
}

function crossSite(): HttpError {
  return new HttpError(403, 'FORBIDDEN', 'This request must come from the app itself.');
}

/** True when the browser says the request came from another origin. Non-browser clients send neither header. */
function isCrossOrigin(req: Request): boolean {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite !== undefined) return fetchSite !== 'same-origin';
  const origin = req.get('origin');
  if (origin === undefined) return false;
  return origin !== `${req.protocol}://${req.get('host') ?? ''}`;
}

/**
 * CSRF guard for state-changing API requests (spec/api.md "Auth and session"). Rejects any request a
 * browser marks as cross-origin (Sec-Fetch-Site, else Origin), and any body that is not JSON, apart
 * from multipart on the two upload routes. Simple cross-site posts (form, text/plain) never reach a handler.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.path.startsWith(API_BASE)) {
    next();
    return;
  }
  if (isCrossOrigin(req)) {
    next(crossSite());
    return;
  }
  const type = mediaType(req);
  const allowed =
    type === null
      ? !hasBody(req)
      : type === 'application/json' || (type === 'multipart/form-data' && MULTIPART_PATHS.some((p) => p.test(req.path)));
  if (!allowed) {
    next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send this request as JSON.'));
    return;
  }
  next();
};
