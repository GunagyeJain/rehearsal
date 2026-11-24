import { Router } from 'express';
import type { HealthResponse } from '@rehearsal/shared';
import type { DbStatus } from '../db';
import type { ScenarioStore } from '../content/loadScenarios';

export interface HealthDeps {
  dbStatus: () => DbStatus;
  scenarios: () => ScenarioStore;
}

/** GET /api/health: always 200 so it can be used for diagnosis; ok is false when anything is down. */
export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    const mongo = deps.dbStatus();
    const scenarioCount = deps.scenarios().count();
    const body: HealthResponse = { ok: mongo === 'up' && scenarioCount > 0, mongo, scenarioCount };
    res.set('Cache-Control', 'no-store').json(body);
  });
  return router;
}
