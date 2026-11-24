import path from 'node:path';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALIBRATION_SCENARIO_ID,
  type ApiErrorBody,
  type AuthUserResponse,
  type BaselineResponse,
  type GeneratePathResponse,
  type PathResponse,
  type Word,
} from '@rehearsal/shared';
import { createApp } from '../src/app';
import { loadScenarioDir } from '../src/content/loadScenarios';
import { getRecordingsBucket } from '../src/db';
import { AttemptModel, PathModel, ProgressModel, RecordingModel, UserModel } from '../src/models';
import { defaultPath, pathViolations, effectiveGoalTrack } from '../src/services/path';
import { signUp, type TestAgent } from './authHelper';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  generateBaselineFeedback: vi.fn(),
  proposePath: vi.fn(),
}));

vi.mock('../src/services/groq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/groq')>()),
  transcribe: mocks.transcribe,
  synthesizeSpeech: vi.fn().mockRejectedValue(new Error('tts is never called in onboarding tests')),
}));

vi.mock('../src/services/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/claude')>()),
  generateTurnLine: vi.fn().mockResolvedValue('Hello.'),
  judgeAttempt: vi.fn().mockResolvedValue(null),
  generateBaselineFeedback: mocks.generateBaselineFeedback,
  proposePath: mocks.proposePath,
}));

/** Own database: vitest runs files in parallel and every suite drops its DB. */
const TEST_DB_URI = 'mongodb://127.0.0.1:27017/rehearsal_test_onboarding';
const GENEROUS_LIMIT = { windowMs: 60_000, limit: 10_000 };
const AUDIO_BYTES = Buffer.from('fake-baseline-audio');

const store = loadScenarioDir(path.resolve(__dirname, '../../content/scenarios')).store;
const app = createApp({
  scenarios: () => store,
  dbStatus: () => 'up',
  authRateLimit: GENEROUS_LIMIT,
  uploadRateLimit: GENEROUS_LIMIT,
});

const PROFILE = { goal: 'job-interview', goalDetail: 'Graduate scheme', timeframe: 'this-month', field: 'Biology', confidence: 2 };

function speech(count = 60): Word[] {
  return Array.from({ length: count }, (_, i) => ({ word: i % 15 === 0 ? 'um' : `word${i}`, start: i * 0.45, end: i * 0.45 + 0.3 }));
}

let emailCounter = 0;
async function freshUser(): Promise<TestAgent> {
  emailCounter += 1;
  return (await signUp(app, `onboard${emailCounter}@test.local`)).agent;
}

function uploadBaseline(agent: TestAgent) {
  return agent
    .post('/api/onboarding/baseline')
    .field('durationSec', '30')
    .attach('audio', AUDIO_BYTES, { filename: 'baseline.webm', contentType: 'audio/webm' });
}

async function userIdOf(agent: TestAgent): Promise<Types.ObjectId> {
  const me = (await agent.get('/api/auth/me')).body as AuthUserResponse;
  return new Types.ObjectId(me.user.id);
}

beforeAll(async () => {
  await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();
  await Promise.all([UserModel.init(), AttemptModel.init(), ProgressModel.init(), PathModel.init(), RecordingModel.init()]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  const words = speech();
  mocks.transcribe.mockResolvedValue({
    transcript: words.map((w) => w.word).join(' '),
    words,
    meanAvgLogprob: -0.2,
    durationSec: 27,
  });
  mocks.generateBaselineFeedback.mockResolvedValue({
    strength: 'You named your field straight away.',
    observation: 'Try pausing instead of saying um.',
  });
  mocks.proposePath.mockResolvedValue(null);
});

describe('PUT /api/onboarding/profile', () => {
  it('saves a valid profile and returns the user', async () => {
    const agent = await freshUser();
    const res = await agent.put('/api/onboarding/profile').send(PROFILE);
    expect(res.status).toBe(200);
    expect((res.body as AuthUserResponse).user).toMatchObject({ profile: PROFILE, onboarded: false });
  });

  it('rejects an invalid profile with field errors', async () => {
    const agent = await freshUser();
    const res = await agent.put('/api/onboarding/profile').send({ ...PROFILE, goal: 'other', goalDetail: '', confidence: 9 });
    expect(res.status).toBe(400);
    const body = res.body as ApiErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.error.fields ?? {})).toEqual(expect.arrayContaining(['confidence']));
  });

  it('can be repeated until the path exists, then returns 409 PATH_EXISTS', async () => {
    const agent = await freshUser();
    expect((await agent.put('/api/onboarding/profile').send(PROFILE)).status).toBe(200);
    expect((await agent.put('/api/onboarding/profile').send({ ...PROFILE, confidence: 4 })).status).toBe(200);
    expect((await agent.post('/api/onboarding/path')).status).toBe(200);
    const res = await agent.put('/api/onboarding/profile').send(PROFILE);
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error.code).toBe('PATH_EXISTS');
  });

  it('requires a session', async () => {
    expect((await request(app).put('/api/onboarding/profile').send(PROFILE)).status).toBe(401);
    expect((await request(app).post('/api/onboarding/path')).status).toBe(401);
    expect((await request(app).get('/api/path')).status).toBe(401);
  });
});

describe('POST /api/onboarding/baseline', () => {
  it('needs a profile first', async () => {
    const agent = await freshUser();
    const res = await uploadBaseline(agent);
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error.code).toBe('PROFILE_REQUIRED');
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('transcribes, computes metrics, asks for feedback and stores a baseline recording', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const res = await uploadBaseline(agent);
    expect(res.status).toBe(200);
    const body = res.body as BaselineResponse;
    expect(body.feedback).toEqual({ strength: 'You named your field straight away.', observation: 'Try pausing instead of saying um.' });
    expect(body.metrics.wordCount).toBe(60);
    expect(body.metrics.fillerCount).toBe(4);
    expect(body.metrics.wpm).toBeGreaterThan(0);
    expect(body.words).toHaveLength(60);
    expect(mocks.generateBaselineFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ metrics: body.metrics, transcript: expect.stringContaining('word1') }),
    );

    const userId = await userIdOf(agent);
    const rec = await RecordingModel.findById(body.recordingId).lean();
    // Larger of Groq's 27 s and the client's 30 s (Groq stops near the last word).
    expect(rec).toMatchObject({ kind: 'baseline', attemptId: null, turnIndex: null, durationSec: 30 });
    expect(rec?.userId.equals(userId)).toBe(true);
    const user = await UserModel.findById(userId).lean();
    expect(user?.baseline?.recordingId?.toHexString()).toBe(body.recordingId);
    expect(user?.baseline?.feedback.strength).toBe('You named your field straight away.');
  });

  it('replaces the previous baseline and deletes its blob on a re-record', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const first = (await uploadBaseline(agent)).body as BaselineResponse;
    const second = (await uploadBaseline(agent)).body as BaselineResponse;
    expect(second.recordingId).not.toBe(first.recordingId);
    const userId = await userIdOf(agent);
    expect(await RecordingModel.countDocuments({ userId })).toBe(1);
    const blobs = await getRecordingsBucket().find({ 'metadata.userId': userId }).toArray();
    expect(blobs.map((b) => b._id.toHexString())).toEqual([second.recordingId]);
  });

  it('rejects unusable takes without storing anything', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    mocks.transcribe.mockResolvedValueOnce({ transcript: '', words: [], meanAvgLogprob: -0.1, durationSec: 5 });
    const none = await uploadBaseline(agent);
    expect(none.status).toBe(422);
    expect((none.body as ApiErrorBody).error.code).toBe('NO_SPEECH');
    mocks.transcribe.mockRejectedValueOnce(new Error('groq down'));
    const down = await uploadBaseline(agent);
    expect(down.status).toBe(503);
    expect((down.body as ApiErrorBody).error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(await RecordingModel.countDocuments({ userId: await userIdOf(agent) })).toBe(0);
  });

  it('rejects non-audio uploads and is closed once the path exists', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const text = await agent
      .post('/api/onboarding/baseline')
      .field('durationSec', '30')
      .attach('audio', AUDIO_BYTES, { filename: 'a.txt', contentType: 'text/plain' });
    expect(text.status).toBe(415);
    await agent.post('/api/onboarding/path');
    const closed = await uploadBaseline(agent);
    expect(closed.status).toBe(409);
    expect((closed.body as ApiErrorBody).error.code).toBe('PATH_EXISTS');
  });
});

describe('POST /api/onboarding/path and GET /api/path', () => {
  it('needs a profile', async () => {
    const agent = await freshUser();
    const res = await agent.post('/api/onboarding/path');
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error.code).toBe('PROFILE_REQUIRED');
  });

  it('returns null before onboarding finishes', async () => {
    const agent = await freshUser();
    expect(((await agent.get('/api/path')).body as PathResponse).path).toBeNull();
  });

  it('falls back to the default path when Claude fails, with item 0 unlocked', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const res = await agent.post('/api/onboarding/path');
    expect(res.status).toBe(200);
    const body = res.body as GeneratePathResponse;
    expect(body.fallback).toBe(true);
    const ids = body.path.items.map((i) => i.scenarioId);
    expect(ids).toEqual(defaultPath(store.list(), 'job-interview'));
    expect(body.path).toMatchObject({ clearedCount: 0, totalCount: ids.length, complete: false, completedAt: null });
    expect(body.path.items[0]).toMatchObject({ state: 'available', isCurrent: true, attemptCount: 0 });
    expect(body.path.items.slice(1).every((i) => i.state === 'locked')).toBe(true);

    const userId = await userIdOf(agent);
    const progress = await ProgressModel.findOne({ userId, scenarioId: CALIBRATION_SCENARIO_ID }).lean();
    expect(progress).toMatchObject({ status: 'available', attemptCount: 0 });
    expect(progress?.unlockedAt).toBeInstanceOf(Date);
    const me = (await agent.get('/api/auth/me')).body as AuthUserResponse;
    expect(me.user.onboarded).toBe(true);
  });

  it('repairs a Claude proposal, sending the baseline metrics and the effective goal track', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send({ ...PROFILE, goal: 'viva' });
    await uploadBaseline(agent);
    mocks.proposePath.mockResolvedValueOnce(['standup-update', 'made-up', CALIBRATION_SCENARIO_ID, 'tell-me-about-yourself']);
    const body = (await agent.post('/api/onboarding/path')).body as GeneratePathResponse;
    expect(body.fallback).toBe(false);
    const ids = body.path.items.map((i) => i.scenarioId);
    expect(ids[0]).toBe(CALIBRATION_SCENARIO_ID);
    expect(ids).not.toContain('made-up');
    expect(pathViolations(ids, store.list(), effectiveGoalTrack('viva', store.list()))).toEqual([]);
    expect(mocks.proposePath).toHaveBeenCalledWith(
      expect.objectContaining({
        goalTrack: 'fundamentals',
        baseline: expect.objectContaining({ wordCount: 60 }),
        library: expect.arrayContaining([expect.objectContaining({ id: 'self-introduction', difficulty: 1 })]),
      }),
    );
  });

  it('is idempotent: the path is generated once and fixed', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const first = (await agent.post('/api/onboarding/path')).body as GeneratePathResponse;
    mocks.proposePath.mockResolvedValue([CALIBRATION_SCENARIO_ID, 'standup-update']);
    const second = (await agent.post('/api/onboarding/path')).body as GeneratePathResponse;
    expect(second.fallback).toBe(false);
    expect(second.path.items.map((i) => i.scenarioId)).toEqual(first.path.items.map((i) => i.scenarioId));
    expect(mocks.proposePath).toHaveBeenCalledTimes(1);
    const userId = await userIdOf(agent);
    expect(await PathModel.countDocuments({ userId })).toBe(1);
    expect(await ProgressModel.countDocuments({ userId })).toBe(1);

    const got = (await agent.get('/api/path')).body as PathResponse;
    expect(got.path?.items.map((i) => i.scenarioId)).toEqual(first.path.items.map((i) => i.scenarioId));
  });

  it('leaves no path or progress behind when the account is deleted while the path is generated', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const userId = await userIdOf(agent);
    mocks.proposePath.mockImplementationOnce(async () => {
      // DELETE /api/account marks the user first; path generation is still in flight.
      await UserModel.updateOne({ _id: userId }, { $set: { deleting: true } });
      return null;
    });
    const res = await agent.post('/api/onboarding/path');
    expect(res.status).toBe(401);
    expect((res.body as ApiErrorBody).error.code).toBe('UNAUTHENTICATED');
    expect(await PathModel.countDocuments({ userId })).toBe(0);
    expect(await ProgressModel.countDocuments({ userId })).toBe(0);
  });

  it('survives concurrent requests with a single stored path', async () => {
    const agent = await freshUser();
    await agent.put('/api/onboarding/profile').send(PROFILE);
    const [a, b] = await Promise.all([agent.post('/api/onboarding/path'), agent.post('/api/onboarding/path')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ids = (r: request.Response): string[] => (r.body as GeneratePathResponse).path.items.map((i) => i.scenarioId);
    expect(ids(a)).toEqual(ids(b));
    expect(await PathModel.countDocuments({ userId: await userIdOf(agent) })).toBe(1);
  });

  it('derives item state from progress and never shows another user\'s path', async () => {
    const owner = await freshUser();
    await owner.put('/api/onboarding/profile').send(PROFILE);
    await owner.post('/api/onboarding/path');
    const ownerId = await userIdOf(owner);
    await ProgressModel.updateOne({ userId: ownerId, scenarioId: CALIBRATION_SCENARIO_ID }, { $set: { status: 'passed', attemptCount: 1 } });
    const view = ((await owner.get('/api/path')).body as PathResponse).path;
    expect(view?.clearedCount).toBe(1);
    expect(view?.items[0]?.state).toBe('passed');
    expect(view?.items[1]).toMatchObject({ state: 'available', isCurrent: true });

    const other = await freshUser();
    expect(((await other.get('/api/path')).body as PathResponse).path).toBeNull();
  });
});
