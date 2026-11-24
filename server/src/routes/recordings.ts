import { Router, type RequestHandler } from 'express';
import type { DeleteAllRecordingsResponse, RecordingListResponse } from '@rehearsal/shared';
import { HttpError, notFound } from '../http/HttpError';
import { userIdOf } from '../middleware/requireUser';
import { parseObjectId } from '../attempts/access';
import { findUserRecording, openRecordingStream, parseByteRange } from '../storage/recordings';
import {
  deleteAllRecordingsAndReferences,
  deleteRecordingAndReferences,
  listUserRecordings,
} from '../storage/manageRecordings';
import type { ScenarioStore } from '../content/loadScenarios';

export interface RecordingsRouterDeps {
  requireUser: RequestHandler;
  scenarios: () => ScenarioStore;
}

/**
 * The user's own recordings: list, stream (with Range support, never a public URL), delete one,
 * delete all. Deleting keeps transcripts and metrics; only the audio and its references go.
 */
export function createRecordingsRouter(deps: RecordingsRouterDeps): Router {
  const router = Router();

  router.get('/recordings', deps.requireUser, async (req, res) => {
    const store = deps.scenarios();
    const body: RecordingListResponse = await listUserRecordings(userIdOf(req), (id) => store.get(id)?.title);
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.delete('/recordings/:id', deps.requireUser, async (req, res) => {
    const deleted = await deleteRecordingAndReferences(userIdOf(req), parseObjectId(req.params.id));
    if (!deleted) throw notFound('That recording does not exist.');
    res.status(204).end();
  });

  router.delete('/account/recordings', deps.requireUser, async (req, res) => {
    const body: DeleteAllRecordingsResponse = { deletedCount: await deleteAllRecordingsAndReferences(userIdOf(req)) };
    res.json(body);
  });

  router.get('/recordings/:id/audio', deps.requireUser, async (req, res, next) => {
    const recording = await findUserRecording(userIdOf(req), parseObjectId(req.params.id));
    if (!recording) throw notFound('That recording does not exist.');
    const size = recording.sizeBytes;
    const range = parseByteRange(req.get('Range'), size);
    res.set('Cache-Control', 'private, no-store');
    if (range === 'unsatisfiable') {
      res.set('Content-Range', `bytes */${size}`);
      throw new HttpError(416, 'BAD_REQUEST', 'That byte range is not available.');
    }
    // File headers only once the range is valid, so JSON error bodies are not labelled audio/*.
    res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': recording.mimeType });
    if (range) {
      res.status(206).set({
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      });
    } else {
      res.status(200).set('Content-Length', String(size));
    }
    const stream = openRecordingStream(recording, range ?? undefined);
    stream.once('error', (error: unknown) => {
      if (!res.headersSent) {
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Range');
        res.removeHeader('Content-Type');
        res.removeHeader('Accept-Ranges');
        next(notFound('That recording does not exist.'));
        return;
      }
      console.error(`[recordings] stream failed for ${recording._id.toHexString()}: ${error instanceof Error ? error.name : 'unknown'}`);
      res.destroy();
    });
    // Release the GridFS cursor when the client aborts (seeking, closing the report).
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  });

  return router;
}
