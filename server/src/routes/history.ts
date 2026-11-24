import { Router, type RequestHandler } from 'express';
import { TREND_METRICS, type AttemptHistoryResponse } from '@rehearsal/shared';
import { HttpError } from '../http/HttpError';
import { userIdOf } from '../middleware/requireUser';
import { AttemptModel, type AttemptDoc } from '../models/Attempt';
import type { ScenarioStore } from '../content/loadScenarios';
import { buildHistoryGroups } from '../history/buildHistory';

export interface HistoryRouterDeps {
  scenarios: () => ScenarioStore;
  requireUser: RequestHandler;
}

const SCENARIO_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SCENARIO_ID_LENGTH = 80;

type HistoryProjection = Pick<AttemptDoc, '_id' | 'scenarioId' | 'startedAt' | 'completedAt' | 'metrics' | 'verdict'>;

function parseScenarioFilter(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > MAX_SCENARIO_ID_LENGTH || !SCENARIO_ID_PATTERN.test(raw)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', { scenarioId: 'Not a scenario id.' });
  }
  return raw;
}

/** GET /api/attempts: the user's scored attempts grouped by scenario, with metric trends. */
export function createHistoryRouter(deps: HistoryRouterDeps): Router {
  const router = Router();

  router.get('/attempts', deps.requireUser, async (req, res) => {
    const scenarioId = parseScenarioFilter(req.query.scenarioId);
    const filter = { userId: userIdOf(req), status: 'scored' as const, ...(scenarioId ? { scenarioId } : {}) };
    // Only the fields history shows: transcripts and word arrays never leave the database here.
    const docs = await AttemptModel.find(filter)
      .select({
        scenarioId: 1,
        startedAt: 1,
        completedAt: 1,
        ...Object.fromEntries(TREND_METRICS.map((m) => [`metrics.${m}`, 1])),
        'verdict.passed': 1,
        'verdict.passedCount': 1,
        'verdict.totalCount': 1,
        'verdict.judgeUnavailable': 1,
      })
      .lean<HistoryProjection[]>();
    const store = deps.scenarios();
    const groups = buildHistoryGroups(
      docs.map((d) => ({
        id: d._id.toHexString(),
        scenarioId: d.scenarioId,
        startedAt: d.startedAt,
        completedAt: d.completedAt,
        metrics: d.metrics,
        verdict: d.verdict,
      })),
      (id) => store.get(id),
    );
    const body: AttemptHistoryResponse = { groups };
    res.set('Cache-Control', 'no-store').json(body);
  });

  return router;
}
