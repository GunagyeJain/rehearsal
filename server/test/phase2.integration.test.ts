import type { IncomingMessage } from 'node:http';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASELINE_PROMPT,
  scenarioSchema,
  type ApiErrorBody,
  type AttemptDetailResponse,
  type ScenarioDetailResponse,
  type StartAttemptResponse,
  type UploadAnswerResponse,
  type Word,
} from '@rehearsal/shared';
import { createApp } from '../src/app';
import { createScenarioStore } from '../src/content/loadScenarios';
import { AttemptModel, PathModel, ProgressModel, RecordingModel, UserModel } from '../src/models';
import { signUp, type TestAgent } from './authHelper';
import { validScenario } from './fixtures';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  synthesizeSpeech: vi.fn(),
  generateTurnLine: vi.fn(),
  judgeAttempt: vi.fn(),
}));

vi.mock('../src/services/groq', () => ({
  GROQ_MODELS: { stt: 'whisper-large-v3-turbo', tts: 'canopylabs/orpheus-v1-english' },
  TTS_VOICE: 'autumn',
  ttsCacheKey: (text: string) => `key-${text.length}-${text.replace(/\W/g, '')}`,
  transcribe: mocks.transcribe,
  synthesizeSpeech: mocks.synthesizeSpeech,
}));

vi.mock('../src/services/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/claude')>()),
  generateTurnLine: mocks.generateTurnLine,
  judgeAttempt: mocks.judgeAttempt,
}));

// Scoring is pure; the mock composes the shared pipeline so these tests do not depend on the service build.
vi.mock('../src/services/scoring', async () => {
  const shared = await import('@rehearsal/shared');
  type Turn = { index: number; aiText: string; transcript: string; words: readonly Word[] };
  const scoring = {
    scoreFirstPass: (scenario: import('@rehearsal/shared').Scenario, turns: readonly Turn[]) => {
      const analysis = shared.computeAttemptMetrics(turns.map((t) => t.words));
      return {
        provisional: {
          metrics: analysis.metrics,
          objective: shared.evaluateObjective(scenario.rubric.objective, analysis.metrics),
          ambiguous: analysis.ambiguous.map(({ id, word, turnIndex, wordIndex }) => ({ id, word, turnIndex, wordIndex })),
        },
        judgeInput: {
          criteria: scenario.rubric.judged,
          turns: turns.map(({ index, aiText, transcript }) => ({ index, aiText, transcript })),
          metrics: analysis.metrics,
          ambiguous: analysis.ambiguous.map(({ id, word, context }) => ({ id, word, context })),
        },
      };
    },
    scoreFinal: (
      scenario: import('@rehearsal/shared').Scenario,
      turnWords: readonly (readonly Word[])[],
      judge: import('../src/services/claude').JudgeOutput | null,
    ) => {
      const first = shared.computeAttemptMetrics(turnWords);
      const metrics = judge ? shared.applyFillerRulings(turnWords, first, judge.fillerRulings) : first.metrics;
      const verdict = shared.buildVerdict({
        rubric: scenario.rubric,
        metrics,
        judge: judge ? { outcomes: judge.criteria, evidence: judge.evidence, nextAction: judge.nextAction } : null,
      });
      return { metrics, verdict };
    },
  };
  return {
    ...scoring,
    scoreAttempt: async (input: { scenario: import('@rehearsal/shared').Scenario; turns: readonly Turn[] }) => {
      const { provisional, judgeInput } = scoring.scoreFirstPass(input.scenario, input.turns);
      const judge = (await mocks.judgeAttempt(judgeInput)) as import('../src/services/claude').JudgeOutput | null;
      return { ...scoring.scoreFinal(input.scenario, input.turns.map((t) => t.words), judge), provisional };
    },
  };
});

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/rehearsal_test';
const POLL_INTERVAL_MS = 50;
const POLL_ATTEMPTS = 60;

const twoTurnScenario = scenarioSchema.parse({
  ...validScenario('two-turn'),
  userInputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
  brief: { scene: 'Talking about {{topic}}.', yourGoal: 'Explain {{topic}} clearly.' },
  turns: [
    {
      index: 0,
      speaker: 'ai',
      persona: 'An interviewer.',
      generate: 'Ask about the topic.',
      userResponse: { maxSeconds: 60, minSeconds: 5, silenceStopSeconds: 3 },
    },
    {
      index: 1,
      speaker: 'ai',
      persona: 'An interviewer.',
      generate: 'Follow up on their answer.',
      dependsOnPreviousAnswer: true,
      userResponse: { maxSeconds: 60, minSeconds: 5, silenceStopSeconds: 3 },
    },
  ],
});
const store = createScenarioStore([scenarioSchema.parse(validScenario()), twoTurnScenario]);

let userA: Types.ObjectId;
/** Cookie agents for two real signed-up users, so cross-user access is exercised through real auth. */
let asA: TestAgent;
let asB: TestAgent;

const app = createApp({
  scenarios: () => store,
  dbStatus: () => 'up',
});

function speech(count = 40, spacing = 0.4): Word[] {
  return Array.from({ length: count }, (_, i) => ({ word: `word${i}`, start: i * spacing, end: i * spacing + 0.3 }));
}

function transcription(words: Word[] = speech(), meanAvgLogprob = -0.2) {
  return { transcript: words.map((w) => w.word).join(' '), words, meanAvgLogprob, durationSec: 16 };
}

const AUDIO_BYTES = Buffer.from('0123456789abcdefghij');

/** superagent types the raw response as its own Response; at runtime the parser receives the IncomingMessage. */
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const stream = res as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function startAttempt(scenarioId = 'test-scenario', userInputs: Record<string, string> = {}): Promise<string> {
  const res = await asA.post('/api/attempts').send({ scenarioId, userInputs });
  expect(res.status).toBe(201);
  return (res.body as StartAttemptResponse).attemptId;
}

function uploadAnswer(attemptId: string, turnIndex: number, user: 'a' | 'b' = 'a') {
  return (user === 'b' ? asB : asA)
    .post(`/api/attempts/${attemptId}/turns/${turnIndex}/answer`)
    .field('durationSec', '16')
    .attach('audio', AUDIO_BYTES, { filename: 'take.webm', contentType: 'audio/webm' });
}

async function pollScored(attemptId: string): Promise<AttemptDetailResponse> {
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    const res = await asA.get(`/api/attempts/${attemptId}`);
    const body = res.body as AttemptDetailResponse;
    if (body.attempt.status === 'scored') return body;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('attempt was never scored');
}

beforeAll(async () => {
  await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();
  await Promise.all([UserModel.init(), AttemptModel.init(), ProgressModel.init(), PathModel.init(), RecordingModel.init()]);
  const a = await signUp(app, 'a@test.local');
  const b = await signUp(app, 'b@test.local');
  userA = new Types.ObjectId(a.user.id);
  asA = a.agent;
  asB = b.agent;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  // Each test starts its own attempts: age earlier ones past the reuse window (not past abandonment).
  await AttemptModel.updateMany({ status: 'in_progress' }, { $set: { startedAt: new Date(Date.now() - 31 * 60 * 1000) } });
  vi.clearAllMocks();
  mocks.generateTurnLine.mockResolvedValue('Hello. Please introduce yourself.');
  mocks.transcribe.mockResolvedValue(transcription());
  mocks.judgeAttempt.mockResolvedValue({
    criteria: [{ id: 'structure', passed: true }],
    evidence: 'You said word1.',
    nextAction: 'Keep the same structure next time. Extra sentence.',
    fillerRulings: [],
  });
  mocks.synthesizeSpeech.mockResolvedValue(Buffer.from('RIFFwav'));
});

describe('authentication and scenarios', () => {
  it('rejects every user-data route without a session', async () => {
    const anon = request(app);
    expect((await anon.get('/api/scenarios/test-scenario')).status).toBe(401);
    expect((await anon.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} })).status).toBe(401);
    expect((await anon.post('/api/tts').send({ prompt: 'baseline' })).status).toBe(401);
    expect((await anon.get(`/api/recordings/${new Types.ObjectId().toHexString()}/audio`)).status).toBe(401);
    expect((await anon.get(`/api/attempts/${new Types.ObjectId().toHexString()}`)).status).toBe(401);
    const forged = await anon.get('/api/scenarios/test-scenario').set('Cookie', 'rehearsal_session=not-a-jwt');
    expect(forged.status).toBe(401);
    expect((forged.body as ApiErrorBody).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns a public scenario without generation prompts', async () => {
    const res = await asA.get('/api/scenarios/test-scenario');
    expect(res.status).toBe(200);
    const body = res.body as ScenarioDetailResponse;
    expect(body.scenario.turns[0]).not.toHaveProperty('generate');
    expect(body.summary.attemptCount).toBe(0);
  });

  it('lists scenarios by track and 404s an unknown one', async () => {
    const list = await asA.get('/api/scenarios');
    expect(list.status).toBe(200);
    expect(list.body.tracks).toHaveLength(5);
    const missing = await asA.get('/api/scenarios/nope');
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/attempts', () => {
  it('creates an attempt with turn 0 generated', async () => {
    mocks.generateTurnLine.mockResolvedValue('Hello. Please introduce yourself.');
    const res = await asA.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} });
    expect(res.status).toBe(201);
    const body = res.body as StartAttemptResponse;
    expect(body.turn.index).toBe(0);
    expect(body.turn.text).toBe('Hello. Please introduce yourself.');
    const stored = await AttemptModel.findById(body.attemptId).lean();
    expect(stored?.userId.equals(userA)).toBe(true);
    expect(stored?.status).toBe('in_progress');
  });

  it('falls back to a neutral line when generation fails', async () => {
    mocks.generateTurnLine.mockRejectedValue(new Error('down'));
    const res = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: 'caching' } });
    expect(res.status).toBe(201);
    expect((res.body as StartAttemptResponse).turn.text).toBe("Let's begin. Explain caching clearly.");
  });

  it('validates userInputs against the scenario', async () => {
    const res = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: {} });
    expect(res.status).toBe(400);
    const body = res.body as ApiErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toHaveProperty('userInputs.topic');
  });

  it('404s an unknown scenario', async () => {
    const res = await asA.post('/api/attempts').send({ scenarioId: 'missing', userInputs: {} });
    expect(res.status).toBe(404);
  });

  it('reuses a recent unanswered attempt with identical inputs instead of generating again', async () => {
    mocks.generateTurnLine.mockResolvedValue('First line.');
    const first = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: 'queues' } });
    expect(first.status).toBe(201);
    mocks.generateTurnLine.mockClear();
    mocks.generateTurnLine.mockResolvedValue('Second line.');
    const again = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: ' queues ' } });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(mocks.generateTurnLine).not.toHaveBeenCalled();
    expect(await AttemptModel.countDocuments({ userId: userA, scenarioId: 'two-turn', 'userInputs.topic': 'queues' })).toBe(1);
  });

  it('creates a new attempt when inputs differ, the attempt is old, or a turn was answered', async () => {
    mocks.generateTurnLine.mockResolvedValue('A line.');
    const base = (await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: 'retries' } }))
      .body as StartAttemptResponse;
    const other = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: 'backoff' } });
    expect(other.status).toBe(201);

    await AttemptModel.updateOne({ _id: other.body.attemptId }, { $set: { startedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    const afterOld = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: 'backoff' } });
    expect(afterOld.status).toBe(201);
    expect((afterOld.body as StartAttemptResponse).attemptId).not.toBe(other.body.attemptId);

    await AttemptModel.updateOne({ _id: base.attemptId }, { $set: { 'turns.0.transcript': 'answered' } });
    const afterAnswer = await asA.post('/api/attempts').send({ scenarioId: 'two-turn', userInputs: { topic: 'retries' } });
    expect(afterAnswer.status).toBe(201);
    expect((afterAnswer.body as StartAttemptResponse).attemptId).not.toBe(base.attemptId);
  });

  it("never reuses another user's attempt and abandons stale ones, which stay out of history", async () => {
    mocks.generateTurnLine.mockResolvedValue('A line.');
    const mine = (await asA.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} })).body as StartAttemptResponse;
    const theirs = await asB.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} });
    expect((theirs.body as StartAttemptResponse).attemptId).not.toBe(mine.attemptId);

    await AttemptModel.updateOne({ _id: mine.attemptId }, { $set: { startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    await asA.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} });
    expect((await AttemptModel.findById(mine.attemptId).lean())?.status).toBe('abandoned');
    const history = await asA.get('/api/attempts?scenarioId=test-scenario');
    const ids = (history.body as { groups: { attempts: { id: string }[] }[] }).groups.flatMap((g) => g.attempts.map((a) => a.id));
    expect(ids).not.toContain(mine.attemptId);
  });
});

describe('turn answers', () => {
  it('uploads, transcribes and stores a turn', async () => {
    const id = await startAttempt();
    const res = await uploadAnswer(id, 0);
    expect(res.status).toBe(200);
    const body = res.body as UploadAnswerResponse;
    expect(body.allTurnsAnswered).toBe(true);
    expect(body.turn.words).toHaveLength(40);
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio/webm');
    const rec = await RecordingModel.findById(body.turn.audioId).lean();
    expect(rec).toMatchObject({ kind: 'attempt', turnIndex: 0, sizeBytes: AUDIO_BYTES.length, mimeType: 'audio/webm' });
    expect(rec?.userId.equals(userA)).toBe(true);
  });

  it('stores the client length when Groq reports a shorter one (trailing silence)', async () => {
    const id = await startAttempt();
    mocks.transcribe.mockResolvedValueOnce({ ...transcription(), durationSec: 1.9 });
    const body = (await uploadAnswer(id, 0)).body as UploadAnswerResponse;
    const rec = await RecordingModel.findById(body.turn.audioId).lean();
    expect(rec?.durationSec).toBeCloseTo(16);
    const doc = await AttemptModel.findById(id).lean();
    expect(doc?.turns.find((t) => t.index === 0)?.audioDurationSec).toBeCloseTo(16);
  });

  it('stores the transcribed length when it is longer than the client figure', async () => {
    const id = await startAttempt();
    mocks.transcribe.mockResolvedValueOnce({ ...transcription(), durationSec: 17.4 });
    const body = (await uploadAnswer(id, 0)).body as UploadAnswerResponse;
    const rec = await RecordingModel.findById(body.turn.audioId).lean();
    expect(rec?.durationSec).toBeCloseTo(17.4);
  });

  it('replaces a re-uploaded turn and deletes the old blob', async () => {
    const id = await startAttempt();
    const first = (await uploadAnswer(id, 0)).body as UploadAnswerResponse;
    const second = (await uploadAnswer(id, 0)).body as UploadAnswerResponse;
    expect(second.turn.audioId).not.toBe(first.turn.audioId);
    expect(await RecordingModel.findById(first.turn.audioId).lean()).toBeNull();
  });

  it('maps unusable takes to 422 and keeps earlier turns', async () => {
    const id = await startAttempt('two-turn', { topic: 'queues' });
    expect((await uploadAnswer(id, 0)).status).toBe(200);
    const gen = await asA.post(`/api/attempts/${id}/turns/1/generate`);
    expect(gen.status).toBe(200);

    mocks.transcribe.mockResolvedValueOnce(transcription([]));
    const none = await uploadAnswer(id, 1);
    expect(none.status).toBe(422);
    expect((none.body as ApiErrorBody).error.code).toBe('NO_SPEECH');

    mocks.transcribe.mockResolvedValueOnce(transcription(speech(), -0.9));
    const low = await uploadAnswer(id, 1);
    expect((low.body as ApiErrorBody).error.code).toBe('TRANSCRIPT_UNRELIABLE');

    mocks.transcribe.mockRejectedValueOnce(Object.assign(new Error('low'), { code: 'TRANSCRIPT_LOW_CONFIDENCE' }));
    const coded = await uploadAnswer(id, 1);
    expect(coded.status).toBe(422);
    expect((coded.body as ApiErrorBody).error.code).toBe('TRANSCRIPT_UNRELIABLE');

    mocks.transcribe.mockResolvedValueOnce(transcription([{ word: 'hi', start: Number.NaN, end: 1 }]));
    const noTimes = await uploadAnswer(id, 1);
    expect((noTimes.body as ApiErrorBody).error.code).toBe('MISSING_TIMESTAMPS');

    mocks.transcribe.mockRejectedValueOnce(new Error('groq down'));
    const down = await uploadAnswer(id, 1);
    expect(down.status).toBe(503);
    expect((down.body as ApiErrorBody).error.code).toBe('UPSTREAM_UNAVAILABLE');

    const detail = (await asA.get(`/api/attempts/${id}`)).body as AttemptDetailResponse;
    expect(detail.attempt.turns[0]?.words).toHaveLength(40);
    expect(detail.attempt.turns[1]?.words).toHaveLength(0);
    expect(await RecordingModel.countDocuments({ attemptId: new Types.ObjectId(id) })).toBe(1);
  });

  it('rejects non-audio uploads with 415 and a missing file with 400', async () => {
    const id = await startAttempt();
    const res = await asA
      .post(`/api/attempts/${id}/turns/0/answer`)
      .field('durationSec', '3')
      .attach('audio', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    const missing = await asA.post(`/api/attempts/${id}/turns/0/answer`).field('durationSec', '3');
    expect(missing.status).toBe(400);
  });

  it('enforces turn order and the previous-answer dependency', async () => {
    const id = await startAttempt('two-turn', { topic: 'locks' });
    const early = await asA.post(`/api/attempts/${id}/turns/1/generate`);
    expect((early.body as ApiErrorBody).error.code).toBe('PREVIOUS_ANSWER_REQUIRED');
    const unasked = await uploadAnswer(id, 1);
    expect((unasked.body as ApiErrorBody).error.code).toBe('TURN_OUT_OF_ORDER');
    await uploadAnswer(id, 0);
    mocks.generateTurnLine.mockResolvedValueOnce('Tell me more about word3.');
    const a = await asA.post(`/api/attempts/${id}/turns/1/generate`);
    const b = await asA.post(`/api/attempts/${id}/turns/1/generate`);
    expect(a.body).toEqual({ index: 1, text: 'Tell me more about word3.' });
    expect(b.body).toEqual(a.body);
    const outOfRange = await asA.post(`/api/attempts/${id}/turns/5/generate`);
    expect(outOfRange.status).toBe(400);
  });
});

describe('finalize and report', () => {
  it('returns 202 provisional, then scores in the background', async () => {
    const id = await startAttempt();
    await uploadAnswer(id, 0);
    const fin = await asA.post(`/api/attempts/${id}/finalize`);
    expect(fin.status).toBe(202);
    const provisional = fin.body as AttemptDetailResponse;
    expect(provisional.attempt.status).toBe('scoring');
    expect(provisional.provisional?.objective).toHaveLength(1);

    const scored = await pollScored(id);
    expect(scored.provisional).toBeNull();
    expect(scored.attempt.verdict?.judgeUnavailable).toBe(false);
    expect(scored.attempt.verdict?.nextAction).toBe('Keep the same structure next time.');
    expect(scored.progress.attemptCount).toBe(1);
    expect(mocks.judgeAttempt).toHaveBeenCalledTimes(1);

    const again = await asA.post(`/api/attempts/${id}/finalize`);
    expect(again.status).toBe(200);
    expect((again.body as AttemptDetailResponse).progress.attemptCount).toBe(1);
    const upload = await uploadAnswer(id, 0);
    expect((upload.body as ApiErrorBody).error.code).toBe('ATTEMPT_CLOSED');
  });

  it('auto-passes judged criteria when the judge fails', async () => {
    mocks.judgeAttempt.mockResolvedValue(null);
    const id = await startAttempt();
    await uploadAnswer(id, 0);
    await asA.post(`/api/attempts/${id}/finalize`);
    const scored = await pollScored(id);
    expect(scored.attempt.verdict?.judgeUnavailable).toBe(true);
    expect(scored.attempt.verdict?.criteria.find((c) => c.id === 'structure')?.passed).toBe(true);
  });

  it('refuses to finalize before every turn is answered', async () => {
    const id = await startAttempt();
    const res = await asA.post(`/api/attempts/${id}/finalize`);
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error.code).toBe('TURNS_INCOMPLETE');
  });
});

describe('GET /api/recordings/:id/audio', () => {
  it('streams the whole file or a byte range', async () => {
    const id = await startAttempt();
    const audioId = ((await uploadAnswer(id, 0)).body as UploadAnswerResponse).turn.audioId;

    const full = await asA.get(`/api/recordings/${audioId}/audio`).buffer(true).parse(binaryParser);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toContain('audio/webm');
    expect(full.headers['cache-control']).toBe('private, no-store');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.compare(full.body as Buffer, AUDIO_BYTES)).toBe(0);

    const part = await asA
      .get(`/api/recordings/${audioId}/audio`)
      .set('Range', 'bytes=2-5')
      .buffer(true)
      .parse(binaryParser);
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 2-5/${AUDIO_BYTES.length}`);
    expect((part.body as Buffer).toString()).toBe('2345');

    const bad = await asA.get(`/api/recordings/${audioId}/audio`).set('Range', 'bytes=999-');
    expect(bad.status).toBe(416);
  });
});

describe('cross-user access', () => {
  it('returns 404 for another users attempt and recording', async () => {
    const id = await startAttempt();
    const audioId = ((await uploadAnswer(id, 0)).body as UploadAnswerResponse).turn.audioId;

    const asUserB = (method: 'get' | 'post', url: string) => asB[method](url);
    expect((await asUserB('get', `/api/attempts/${id}`)).status).toBe(404);
    expect((await asUserB('post', `/api/attempts/${id}/finalize`)).status).toBe(404);
    expect((await asUserB('post', `/api/attempts/${id}/turns/0/generate`)).status).toBe(404);
    expect((await asUserB('get', `/api/recordings/${audioId}/audio`)).status).toBe(404);
    expect((await uploadAnswer(id, 0, 'b')).status).toBe(404);
    expect((await asA.get('/api/attempts/not-an-id')).status).toBe(404);
  });
});

describe('POST /api/tts', () => {
  it('returns wav audio with an ETag and honours If-None-Match without synthesizing', async () => {
    const attemptId = await startAttempt();
    const line = { attemptId, turnIndex: 0 };
    const first = await asA.post('/api/tts').send(line).buffer(true).parse(binaryParser);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toContain('audio/wav');
    expect(first.headers['cache-control']).toBe('private, max-age=86400');
    const etag = first.headers.etag as string;
    const cached = await asA.post('/api/tts').set('If-None-Match', etag).send(line);
    expect(cached.status).toBe(304);
    expect(mocks.synthesizeSpeech).toHaveBeenCalledTimes(1);
  });

  it('speaks only known lines: free text is rejected, another user line or a missing line is 404', async () => {
    expect((await asA.post('/api/tts').send({ text: 'Any text at all.' })).status).toBe(400);
    const attemptId = await startAttempt();
    expect((await asA.post('/api/tts').send({ attemptId, turnIndex: 5 })).status).toBe(404);
    expect((await asB.post('/api/tts').send({ attemptId, turnIndex: 0 })).status).toBe(404);
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
    const baseline = await asA.post('/api/tts').send({ prompt: 'baseline' });
    expect(baseline.status).toBe(200);
    expect(mocks.synthesizeSpeech).toHaveBeenCalledWith(BASELINE_PROMPT);
  });

  it('maps synthesis failure to 503', async () => {
    mocks.synthesizeSpeech.mockRejectedValueOnce(new Error('down'));
    const res = await asA.post('/api/tts').send({ prompt: 'baseline' });
    expect(res.status).toBe(503);
    expect((res.body as ApiErrorBody).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});
