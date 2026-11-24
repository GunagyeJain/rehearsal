import { Router, type RequestHandler } from 'express';
import type { SkipResponse } from '@rehearsal/shared';
import { notFound } from '../http/HttpError';
import { userIdOf } from '../middleware/requireUser';
import type { ScenarioStore } from '../content/loadScenarios';
import { skipPathItem } from '../attempts/progress';

export interface PathSkipRouterDeps {
  scenarios: () => ScenarioStore;
  requireUser: RequestHandler;
}

/** Scenario ids are kebab-case file names; anything else cannot be on a path. */
const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCENARIO_ID_MAX_LENGTH = 100;

/** POST /api/path/:scenarioId/skip (Phase 6). */
export function createPathSkipRouter(deps: PathSkipRouterDeps): Router {
  const router = Router();

  router.post('/path/:scenarioId/skip', deps.requireUser, async (req, res) => {
    const { scenarioId } = req.params;
    if (typeof scenarioId !== 'string' || scenarioId.length > SCENARIO_ID_MAX_LENGTH || !SCENARIO_ID_PATTERN.test(scenarioId)) {
      throw notFound('That scenario is not on your path.');
    }
    const body: SkipResponse = { path: await skipPathItem(userIdOf(req), scenarioId, deps.scenarios()) };
    res.set('Cache-Control', 'no-store').json(body);
  });

  return router;
}
