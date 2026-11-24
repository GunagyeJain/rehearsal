import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

/** spec/api.md "Auth and session". */
export const SESSION_COOKIE = 'rehearsal_session';
const SESSION_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * DAY_MS;
const JWT_ALGORITHM = 'HS256';
const MIN_SECRET_LENGTH = 16;

/** JWT_SECRET is validated at startup by loadEnv; read lazily so tests can set it per file. */
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new Error('[auth] JWT_SECRET is not configured');
  return secret;
}

/** What a valid token carries: the user and the session version it was issued under. */
export interface SessionClaims {
  userId: Types.ObjectId;
  sessionVersion: number;
}

export function signSession(userId: Types.ObjectId, sessionVersion: number): string {
  return jwt.sign({ sv: sessionVersion }, jwtSecret(), {
    algorithm: JWT_ALGORITHM,
    subject: userId.toHexString(),
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });
}

/** The claims of a valid, unexpired token, or null for anything else. Never throws. */
export function verifySession(token: unknown): SessionClaims | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: [JWT_ALGORITHM] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    if (!(Types.ObjectId.isValid(payload.sub) && /^[0-9a-f]{24}$/i.test(payload.sub))) return null;
    // Tokens issued before session versions existed carry no `sv`: they count as version 0.
    const sv: unknown = payload.sv ?? 0;
    if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 0) return null;
    return { userId: new Types.ObjectId(payload.sub), sessionVersion: sv };
  } catch {
    return null;
  }
}

function cookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: production };
}

export function setSessionCookie(res: Response, userId: Types.ObjectId, sessionVersion: number, production: boolean): void {
  res.cookie(SESSION_COOKIE, signSession(userId, sessionVersion), { ...cookieOptions(production), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response, production: boolean): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(production));
}
