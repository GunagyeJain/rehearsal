import { Router, type RequestHandler } from 'express';
import { BASELINE_PROMPT, ttsRequestSchema, type TtsRequest } from '@rehearsal/shared';
import type { Types } from 'mongoose';
import { HttpError } from '../http/HttpError';
import { parseBody } from '../middleware/validate';
import { userIdOf } from '../middleware/requireUser';
import { AttemptModel } from '../models/Attempt';
import { synthesizeSpeech, ttsCacheKey } from '../services/groq';

/** " upstream 429" for an UpstreamError-shaped error, so a rate limit is visible in the log. */
function upstreamStatusOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('upstreamStatus' in error)) return '';
  const { upstreamStatus } = error;
  return ` upstream ${typeof upstreamStatus === 'number' ? upstreamStatus : 'no-response'}`;
}

export interface TtsRouterDeps {
  requireUser: RequestHandler;
  generationLimiter: RequestHandler;
  /** Per-user daily cap, so one account cannot spend the shared Groq TTS quota. */
  ttsDailyLimiter: RequestHandler;
}

/** The text to speak: a fixed prompt, or the stored line of one of this user's attempts. */
async function resolveText(userId: Types.ObjectId, request: TtsRequest): Promise<string> {
  if ('prompt' in request) return BASELINE_PROMPT;
  const attempt = await AttemptModel.findOne({ _id: request.attemptId, userId }).select('turns.index turns.aiText').lean();
  const turn = attempt?.turns.find((t) => t.index === request.turnIndex);
  if (!turn) throw new HttpError(404, 'NOT_FOUND', 'That line does not exist.');
  return turn.aiText;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((tag) => {
    const t = tag.trim().replace(/^W\//, '');
    return t === etag || t === '*';
  });
}

/** POST /api/tts: a known line -> audio/wav with an ETag so the browser can revalidate with If-None-Match. */
export function createTtsRouter(deps: TtsRouterDeps): Router {
  const router = Router();

  router.post('/tts', deps.requireUser, deps.generationLimiter, deps.ttsDailyLimiter, async (req, res) => {
    const text = await resolveText(userIdOf(req), parseBody(ttsRequestSchema, req.body));
    const key = ttsCacheKey(text);
    const etag = `"${key}"`;
    res.set({ 'Cache-Control': 'private, max-age=86400', ETag: etag });
    if (etagMatches(req.get('If-None-Match'), etag)) {
      res.status(304).end();
      return;
    }
    // The service caches by the same key (memory LRU + .data/tts-cache), so replays never re-bill Groq.
    let audio: Buffer;
    try {
      audio = await synthesizeSpeech(text);
    } catch (error: unknown) {
      const upstream = upstreamStatusOf(error);
      console.warn(`[tts] synthesis failed (${error instanceof Error ? error.name : 'unknown'}${upstream})`);
      throw new HttpError(503, 'UPSTREAM_UNAVAILABLE', 'Audio is unavailable right now. The line is shown as text.');
    }
    res.type('audio/wav').send(audio);
  });

  return router;
}
