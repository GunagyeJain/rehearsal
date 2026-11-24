import type { Request, RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { HttpError } from '../http/HttpError';
import { UserModel } from '../models/User';
import { SESSION_COOKIE, verifySession, type SessionClaims } from '../auth/session';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireUser. Every user-data query filters by this. */
    userId?: Types.ObjectId;
  }
}

function unauthenticated(): HttpError {
  return new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
}

/** The claims of a valid session cookie, or null. Does not check the user or the session version. */
export function sessionClaims(req: Request): SessionClaims | null {
  const cookies: unknown = req.cookies;
  const token = typeof cookies === 'object' && cookies !== null ? (cookies as Record<string, unknown>)[SESSION_COOKIE] : undefined;
  return verifySession(token);
}

/**
 * JWT cookie authentication (spec/api.md "Auth and session"). A valid token for a deleted account,
 * or one issued before the last sign-out (older sessionVersion), is rejected too.
 */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const claims = sessionClaims(req);
  if (!claims) {
    next(unauthenticated());
    return;
  }
  const user = await UserModel.findOne({ _id: claims.userId }).select('sessionVersion deleting').lean();
  if (!user || user.deleting === true || (user.sessionVersion ?? 0) !== claims.sessionVersion) {
    next(unauthenticated());
    return;
  }
  req.userId = claims.userId;
  next();
};

/** Read the authenticated user id inside a handler that runs after requireUser. */
export function userIdOf(req: Request): Types.ObjectId {
  if (!req.userId) throw unauthenticated();
  return req.userId;
}
