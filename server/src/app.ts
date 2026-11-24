import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { API_BASE } from '@rehearsal/shared';
import { dbStatus as liveDbStatus } from './db';
import { getScenarioStore } from './content/loadScenarios';
import { createHealthRouter, type HealthDeps } from './routes/health';
import { createScenariosRouter } from './routes/scenarios';
import { createAttemptsRouter } from './routes/attempts';
import { createAnswersRouter } from './routes/answers';
import { createTtsRouter } from './routes/tts';
import { createRecordingsRouter } from './routes/recordings';
import { createAuthRouter } from './routes/auth';
import { createUsersRouter } from './routes/users';
import { createOnboardingRouter } from './routes/onboarding';
import { createPathSkipRouter } from './routes/pathSkip';
import { createHistoryRouter } from './routes/history';
import { apiNotFound, createErrorHandler } from './middleware/errorHandler';
import {
  AUTH_RATE_LIMIT,
  createRateLimiter,
  GENERATION_RATE_LIMIT,
  TTS_DAILY_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
  userRateLimitKey,
  type RateLimitConfig,
} from './middleware/rateLimit';
import { requireUser as defaultRequireUser } from './middleware/requireUser';
import { csrfGuard } from './middleware/csrf';

/** JSON bodies are small (audio goes through multer on specific routes). */
export const JSON_BODY_LIMIT = '100kb';

export interface AppOptions extends Partial<HealthDeps> {
  production?: boolean;
  authRateLimit?: RateLimitConfig;
  generationRateLimit?: RateLimitConfig;
  uploadRateLimit?: RateLimitConfig;
  ttsDailyRateLimit?: RateLimitConfig;
  /** Express 'trust proxy' (TRUST_PROXY env). Defaults to false so a client cannot pick its req.ip. */
  trustProxy?: boolean | number | string;
  /** Authentication middleware; defaults to the JWT cookie requireUser. */
  requireUser?: RequestHandler;
}

/** Build the Express app. Dependencies are injectable so tests can swap them. */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const scenarios = options.scenarios ?? getScenarioStore;
  const requireUser = options.requireUser ?? defaultRequireUser;
  const generationLimiter = createRateLimiter({
    ...(options.generationRateLimit ?? GENERATION_RATE_LIMIT),
    keyGenerator: userRateLimitKey,
  });
  const ttsDailyLimiter = createRateLimiter({
    ...(options.ttsDailyRateLimit ?? TTS_DAILY_RATE_LIMIT),
    keyGenerator: userRateLimitKey,
  });
  const uploadLimiter = createRateLimiter({ ...(options.uploadRateLimit ?? UPLOAD_RATE_LIMIT), keyGenerator: userRateLimitKey });

  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? false);
  app.use(helmet());
  app.use(csrfGuard);
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  // Credential routes only (signup, signin, delete account); GET /auth/me runs on every page load.
  const authLimiter = createRateLimiter(options.authRateLimit ?? AUTH_RATE_LIMIT);

  app.use(API_BASE, createHealthRouter({ dbStatus: options.dbStatus ?? liveDbStatus, scenarios }));
  app.use(API_BASE, createScenariosRouter({ scenarios, requireUser }));
  app.use(API_BASE, createHistoryRouter({ scenarios, requireUser }));
  app.use(API_BASE, createAttemptsRouter({ scenarios, requireUser, generationLimiter }));
  app.use(API_BASE, createAnswersRouter({ scenarios, requireUser, uploadLimiter }));
  app.use(API_BASE, createTtsRouter({ requireUser, generationLimiter, ttsDailyLimiter }));
  app.use(API_BASE, createRecordingsRouter({ requireUser, scenarios }));
  app.use(API_BASE, createAuthRouter({ requireUser, authLimiter, production }));
  app.use(API_BASE, createUsersRouter({ requireUser }));
  app.use(API_BASE, createOnboardingRouter({ scenarios, requireUser, uploadLimiter }));
  app.use(API_BASE, createPathSkipRouter({ scenarios, requireUser }));

  app.use(API_BASE, apiNotFound);
  app.use(createErrorHandler({ production }));
  return app;
}
