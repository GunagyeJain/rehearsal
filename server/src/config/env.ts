import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** server/ directory, resolved from this file so the working directory never matters. */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEFAULT_PORT = 4000;
/** Loopback by default; set HOST=0.0.0.0 (or an interface address) to expose the server deliberately. */
const DEFAULT_HOST = '127.0.0.1';
const MIN_JWT_SECRET_LENGTH = 16;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(DEFAULT_PORT),
  HOST: z.string().trim().min(1).default(DEFAULT_HOST),
  MONGODB_URI: z.string().trim().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
  ANTHROPIC_API_KEY: z.string().trim().min(1, 'is required'),
  GROQ_API_KEY: z.string().trim().min(1, 'is required'),
  JWT_SECRET: z.string().min(MIN_JWT_SECRET_LENGTH, `must be at least ${MIN_JWT_SECRET_LENGTH} characters`),
  /**
   * Express 'trust proxy': unset or "false" trusts no proxy (req.ip is the socket peer), a whole
   * number is a hop count, anything else is a comma-separated list of addresses or subnets.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .regex(/^(false|\d+|[0-9a-fA-F.:/, ]+|loopback|linklocal|uniquelocal)$/, 'must be false, a hop count, or addresses/subnets')
    .optional(),
  /** Optional override, mainly for tests. Defaults to <repo>/content/scenarios. */
  SCENARIOS_DIR: z.string().trim().min(1).optional(),
});

export type EnvConfig = Readonly<z.infer<typeof envSchema>>;

/** Raised when the environment is invalid. The message names keys only, never values. */
export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid server environment (check server/.env):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

/** Validate a raw environment object. Pure, so tests can pass any record. */
export function parseEnv(raw: Readonly<Record<string, string | undefined>>): EnvConfig {
  const result = envSchema.safeParse(raw);
  if (result.success) return Object.freeze(result.data);
  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    const missing = raw[key] === undefined || raw[key] === '';
    return missing ? `${key} is missing` : `${key} ${issue.message}`;
  });
  throw new EnvValidationError(problems);
}

/** Load server/.env (if present) into process.env, then validate. Existing process.env values win. */
export function loadEnv(): EnvConfig {
  dotenv.config({ path: path.join(SERVER_ROOT, '.env'), quiet: true });
  return parseEnv(process.env);
}

/** The Express 'trust proxy' value for TRUST_PROXY. Defaults to false: X-Forwarded-For is ignored. */
export function trustProxySetting(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export function defaultScenariosDir(config: Pick<EnvConfig, 'SCENARIOS_DIR'>): string {
  return config.SCENARIOS_DIR
    ? path.resolve(config.SCENARIOS_DIR)
    : path.resolve(SERVER_ROOT, '..', 'content', 'scenarios');
}
