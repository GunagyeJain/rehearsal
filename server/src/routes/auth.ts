import { Router, type RequestHandler } from 'express';
import { credentialsSchema, deleteAccountSchema, DEFAULT_SETTINGS, type AuthUserResponse } from '@rehearsal/shared';
import { HttpError } from '../http/HttpError';
import { parseBody } from '../middleware/validate';
import { sessionClaims, userIdOf } from '../middleware/requireUser';
import { UserModel } from '../models/User';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { clearSessionCookie, setSessionCookie } from '../auth/session';
import { loadUserDto, toUserDto } from '../users/serialize';
import { deleteUserAccount } from '../users/deleteAccount';
import { createSigninThrottle, type SigninThrottle } from '../auth/signinThrottle';

export interface AuthRouterDeps {
  requireUser: RequestHandler;
  /** Rate limiter for credential checks outside /api/auth (DELETE /api/account). */
  authLimiter: RequestHandler;
  production: boolean;
  /** Per-email failure limit on sign-in; defaults to a fresh in-memory throttle. */
  signinThrottle?: SigninThrottle;
}

const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect.';
const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists. Sign in instead.';
const DUPLICATE_KEY = 11000;

function invalidCredentials(): HttpError {
  return new HttpError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
}

function emailTaken(): HttpError {
  return new HttpError(409, 'EMAIL_TAKEN', EMAIL_TAKEN_MESSAGE, { email: EMAIL_TAKEN_MESSAGE });
}

function accountLocked(): HttpError {
  return new HttpError(429, 'RATE_LIMITED', 'Too many sign-in attempts for this account. Wait 15 minutes and try again.');
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY;
}

/** /api/auth/* and DELETE /api/account. Request bodies (passwords) are never logged. */
export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const signinThrottle = deps.signinThrottle ?? createSigninThrottle();

  router.post('/auth/signup', deps.authLimiter, async (req, res) => {
    const { email, password } = parseBody(credentialsSchema, req.body);
    if (await UserModel.exists({ email })) throw emailTaken();
    const passwordHash = await hashPassword(password);
    let created;
    try {
      created = await UserModel.create({ email, passwordHash, settings: { ...DEFAULT_SETTINGS } });
    } catch (error: unknown) {
      // Two sign-ups racing past the exists check: the unique index decides.
      if (isDuplicateKey(error)) throw emailTaken();
      throw error;
    }
    setSessionCookie(res, created._id, created.sessionVersion, deps.production);
    const body: AuthUserResponse = { user: toUserDto(created, false) };
    res.status(201).json(body);
  });

  router.post('/auth/signin', deps.authLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    // A malformed email or short password can never match: same answer as a wrong password.
    if (!parsed.success) throw invalidCredentials();
    const { email, password } = parsed.data;
    // Applies to unknown emails too, so the lock never reveals whether an account exists.
    if (signinThrottle.isLocked(email)) throw accountLocked();
    const user = await UserModel.findOne({ email }).select('_id passwordHash sessionVersion').lean();
    const ok = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !ok) {
      signinThrottle.recordFailure(email);
      throw invalidCredentials();
    }
    signinThrottle.recordSuccess(email);
    setSessionCookie(res, user._id, user.sessionVersion ?? 0, deps.production);
    const body: AuthUserResponse = { user: await loadUserDto(user._id) };
    res.json(body);
  });

  router.post('/auth/signout', async (req, res) => {
    // Revoke every token issued under the current version, not just this cookie.
    const claims = sessionClaims(req);
    if (claims) {
      await UserModel.updateOne(
        { _id: claims.userId, sessionVersion: claims.sessionVersion },
        { $inc: { sessionVersion: 1 } },
      );
    }
    clearSessionCookie(res, deps.production);
    res.status(204).end();
  });

  router.get('/auth/me', deps.requireUser, async (req, res) => {
    const body: AuthUserResponse = { user: await loadUserDto(userIdOf(req)) };
    res.json(body);
  });

  router.delete('/account', deps.authLimiter, deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const { password } = parseBody(deleteAccountSchema, req.body);
    const user = await UserModel.findOne({ _id: userId }).select('passwordHash').lean();
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw invalidCredentials();
    await deleteUserAccount(userId);
    clearSessionCookie(res, deps.production);
    res.status(204).end();
  });

  return router;
}
