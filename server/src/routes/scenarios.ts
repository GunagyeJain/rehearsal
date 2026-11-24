import { Router, type RequestHandler } from 'express';
import {
  TRACK_IDS,
  TRACK_LABELS,
  type ScenarioDetailResponse,
  type ScenarioListResponse,
  type ScenarioSummary,
} from '@rehearsal/shared';
import { notFound } from '../http/HttpError';
import { userIdOf } from '../middleware/requireUser';
import type { ScenarioStore } from '../content/loadScenarios';
import { userScenarioStates } from '../attempts/progress';
import { toPublicScenario, toScenarioSummary } from '../attempts/serialize';

export interface ScenariosRouterDeps {
  scenarios: () => ScenarioStore;
  requireUser: RequestHandler;
}

function bySummaryOrder(a: ScenarioSummary, b: ScenarioSummary): number {
  return a.difficulty - b.difficulty || a.title.localeCompare(b.title);
}

/** Scenario content always comes from the loaded JSON files, never from code. */
export function createScenariosRouter(deps: ScenariosRouterDeps): Router {
  const router = Router();

  router.get('/scenarios', deps.requireUser, async (req, res) => {
    const { states, onPath } = await userScenarioStates(userIdOf(req), deps.scenarios());
    const summaries = deps
      .scenarios()
      .list()
      .map((s) => toScenarioSummary(s, states.get(s.id) ?? { onPath: onPath(s.id), state: null, attemptCount: 0 }));
    const body: ScenarioListResponse = {
      tracks: TRACK_IDS.map((track) => ({
        track,
        label: TRACK_LABELS[track],
        scenarios: summaries.filter((s) => s.track === track).sort(bySummaryOrder),
      })),
    };
    res.json(body);
  });

  router.get('/scenarios/:id', deps.requireUser, async (req, res) => {
    const scenario = typeof req.params.id === 'string' ? deps.scenarios().get(req.params.id) : undefined;
    if (!scenario) throw notFound('That scenario does not exist.');
    const { states, canSkip, onPath } = await userScenarioStates(userIdOf(req), deps.scenarios());
    const body: ScenarioDetailResponse = {
      scenario: toPublicScenario(scenario),
      summary: toScenarioSummary(scenario, states.get(scenario.id) ?? { onPath: onPath(scenario.id), state: null, attemptCount: 0 }),
      canSkip: canSkip(scenario.id),
    };
    res.json(body);
  });

  return router;
}
