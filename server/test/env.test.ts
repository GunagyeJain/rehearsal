import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv, trustProxySetting } from '../src/config/env';

const VALID = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/rehearsal-test',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  GROQ_API_KEY: 'test-groq-key',
  JWT_SECRET: 'a-test-secret-that-is-long-enough',
};

describe('parseEnv', () => {
  it('accepts a complete environment and applies defaults', () => {
    const config = parseEnv(VALID);
    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('accepts TRUST_PROXY=1 (dev behind the vite proxy) as a single hop', () => {
    const config = parseEnv({ ...VALID, TRUST_PROXY: '1' });
    expect(config.TRUST_PROXY).toBe('1');
    expect(trustProxySetting(config.TRUST_PROXY)).toBe(1);
    expect(trustProxySetting(undefined)).toBe(false);
  });

  it('coerces PORT', () => {
    expect(parseEnv({ ...VALID, PORT: '5050' }).PORT).toBe(5050);
  });

  it('fails fast naming every missing key', () => {
    try {
      parseEnv({});
      expect.unreachable('parseEnv should throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      for (const key of ['MONGODB_URI', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'JWT_SECRET']) {
        expect(message).toContain(`${key} is missing`);
      }
    }
  });

  it('rejects a malformed value without echoing it', () => {
    const secret = 'short';
    try {
      parseEnv({ ...VALID, JWT_SECRET: secret, MONGODB_URI: 'postgres://nope' });
      expect.unreachable('parseEnv should throw');
    } catch (error: unknown) {
      const message = (error as Error).message;
      expect(message).toContain('JWT_SECRET');
      expect(message).toContain('MONGODB_URI');
      expect(message).not.toContain(secret);
      expect(message).not.toContain('postgres://nope');
    }
  });
});
