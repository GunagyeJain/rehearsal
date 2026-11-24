import request from 'supertest';
import type { Express } from 'express';
import { expect } from 'vitest';
import type { AuthUserResponse } from '@rehearsal/shared';

/** Tests sign real JWTs; the value only has to satisfy the length rule. */
process.env.JWT_SECRET ??= 'test-only-jwt-secret-0123456789';

export type TestAgent = ReturnType<typeof request.agent>;

export const TEST_PASSWORD = 'correct horse battery';

export interface SignedUpUser {
  agent: TestAgent;
  user: AuthUserResponse['user'];
}

/** Sign up a fresh user and return a cookie-carrying agent for them. */
export async function signUp(app: Express, email: string, password = TEST_PASSWORD): Promise<SignedUpUser> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').send({ email, password });
  expect(res.status).toBe(201);
  return { agent, user: (res.body as AuthUserResponse).user };
}
