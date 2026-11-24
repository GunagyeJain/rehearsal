import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { scenarioSchema, type ApiErrorBody, type HealthResponse } from '@rehearsal/shared';
import { createApp } from '../src/app';
import { createScenarioStore } from '../src/content/loadScenarios';
import { validScenario } from './fixtures';

const oneScenario = createScenarioStore([scenarioSchema.parse(validScenario())]);

describe('GET /api/health', () => {
  it('reports ok when mongo is up and scenarios are loaded', async () => {
    const app = createApp({ dbStatus: () => 'up', scenarios: () => oneScenario });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body as HealthResponse).toEqual({ ok: true, mongo: 'up', scenarioCount: 1 });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns 200 with ok false when mongo is down', async () => {
    const app = createApp({ dbStatus: () => 'down', scenarios: () => oneScenario });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body as HealthResponse).toEqual({ ok: false, mongo: 'down', scenarioCount: 1 });
  });

  it('returns ok false when no scenarios loaded', async () => {
    const app = createApp({ dbStatus: () => 'up', scenarios: () => createScenarioStore([]) });
    const res = await request(app).get('/api/health');
    expect((res.body as HealthResponse).ok).toBe(false);
  });
});

describe('error handling', () => {
  const app = createApp({ dbStatus: () => 'up', scenarios: () => oneScenario, production: true });

  it('returns ApiErrorBody NOT_FOUND for unknown api routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect((res.body as ApiErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('maps malformed JSON to BAD_REQUEST without a stack', async () => {
    const res = await request(app).post('/api/nope').set('Content-Type', 'application/json').send('{ bad');
    expect(res.status).toBe(400);
    const body = res.body as ApiErrorBody;
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(body)).not.toContain('at ');
  });

  it('rate limits /api/auth', async () => {
    const limited = createApp({
      dbStatus: () => 'up',
      scenarios: () => oneScenario,
      authRateLimit: { windowMs: 60_000, limit: 2 },
    });
    await request(limited).post('/api/auth/signin');
    await request(limited).post('/api/auth/signin');
    const res = await request(limited).post('/api/auth/signin');
    expect(res.status).toBe(429);
    expect((res.body as ApiErrorBody).error.code).toBe('RATE_LIMITED');
  });
});
