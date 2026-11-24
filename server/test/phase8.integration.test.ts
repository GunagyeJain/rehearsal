import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scenarioSchema,
  type AttemptDetailResponse,
  type AttemptHistoryResponse,
  type DeleteAllRecordingsResponse,
  type RecordingListResponse,
  type StartAttemptResponse,
  type UploadAnswerResponse,
  type Word,
} from '@rehearsal/shared';
import { createApp } from '../src/app';
import { createScenarioStore } from '../src/content/loadScenarios';
import { getRecordingsBucket } from '../src/db';
import { AttemptModel, PathModel, ProgressModel, RecordingModel, UserModel } from '../src/models';
import { putRecording } from '../src/storage/recordings';
import { signUp, type TestAgent } from './authHelper';
import { validScenario } from './fixtures';

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), generateTurnLine: vi.fn() }));

vi.mock('../src/services/groq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/groq')>()),
  transcribe: mocks.transcribe,
  synthesizeSpeech: vi.fn().mockRejectedValue(new Error('tts is not called in phase 8 tests')),
}));

vi.mock('../src/services/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/claude')>()),
  generateTurnLine: mocks.generateTurnLine,
  judgeAttempt: vi.fn().mockResolvedValue(null),
}));

/** Own database: vitest runs files in parallel and each suite drops its DB. */
const TEST_DB_URI = 'mongodb://127.0.0.1:27017/rehearsal_test_phase8';
const GENEROUS_LIMIT = { windowMs: 60_000, limit: 10_000 };
const AUDIO_BYTES = Buffer.from('fake-audio-bytes');

const store = createScenarioStore([
  scenarioSchema.parse(validScenario()),
  scenarioSchema.parse({ ...validScenario('second-scenario'), title: 'Second scenario', difficulty: 2 }),
]);
const app = createApp({ scenarios: () => store, dbStatus: () => 'up', authRateLimit: GENEROUS_LIMIT });

function speech(count = 40): Word[] {
  return Array.from({ length: count }, (_, i) => ({ word: `word${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));
}

let emailCounter = 0;
function freshEmail(): string {
  emailCounter += 1;
  return `p8user${emailCounter}@test.local`;
}

async function recordOneTurn(agent: TestAgent): Promise<{ attemptId: string; audioId: string }> {
  const start = await agent.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} });
  expect(start.status).toBe(201);
  const attemptId = (start.body as StartAttemptResponse).attemptId;
  const upload = await agent
    .post(`/api/attempts/${attemptId}/turns/0/answer`)
    .field('durationSec', '16')
    .attach('audio', AUDIO_BYTES, { filename: 'take.webm', contentType: 'audio/webm' });
  expect(upload.status).toBe(200);
  return { attemptId, audioId: (upload.body as UploadAnswerResponse).turn.audioId };
}

async function blobExists(id: string): Promise<boolean> {
  return (await getRecordingsBucket().find({ _id: new Types.ObjectId(id) }).toArray()).length === 1;
}

interface ScoredSeed {
  scenarioId: string;
  completedAt: string;
  wpm: number;
  fillersPerMinute: number;
  passedCount: number;
}

async function seedScored(userId: string, seed: ScoredSeed): Promise<string> {
  const completedAt = new Date(seed.completedAt);
  const doc = await AttemptModel.create({
    userId: new Types.ObjectId(userId),
    scenarioId: seed.scenarioId,
    status: 'scored',
    startedAt: new Date(completedAt.getTime() - 60_000),
    completedAt,
    turns: [{ index: 0, aiText: 'Hello', audioId: null, transcript: 'secret words', words: speech(3) }],
    metrics: {
      wpm: seed.wpm,
      fillersPerMinute: seed.fillersPerMinute,
      longestPauseSec: 1.5,
      durationSec: 40,
      pauseCount2s: 0,
      speakingSec: 40,
      wordCount: 90,
      contentWordCount: 88,
      fillerCount: 2,
      fillerMarks: [],
      pauseMarks: [],
      paceWindows: [],
    },
    verdict: {
      criteria: [],
      passedCount: seed.passedCount,
      totalCount: 2,
      passed: seed.passedCount === 2,
      evidence: '',
      nextAction: 'Slow down.',
      judgeUnavailable: false,
    },
  });
  return doc._id.toHexString();
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
  mocks.generateTurnLine.mockResolvedValue('Hello. Please introduce yourself.');
  mocks.transcribe.mockResolvedValue({
    transcript: speech().map((w) => w.word).join(' '),
    words: speech(),
    meanAvgLogprob: -0.2,
    durationSec: 16,
  });
});

describe('GET /api/recordings', () => {
  it('lists only the signed-in user\'s recordings with count, total size and scenario title', async () => {
    const owner = await signUp(app, freshEmail());
    const other = await signUp(app, freshEmail());
    await recordOneTurn(owner.agent);
    await recordOneTurn(other.agent);

    const res = await owner.agent.get('/api/recordings');
    expect(res.status).toBe(200);
    const body = res.body as RecordingListResponse;
    expect(body.count).toBe(1);
    expect(body.totalBytes).toBe(AUDIO_BYTES.length);
    expect(body.recordings[0]).toMatchObject({
      kind: 'attempt',
      scenarioId: 'test-scenario',
      scenarioTitle: 'Test scenario',
      turnIndex: 0,
      sizeBytes: AUDIO_BYTES.length,
    });
  });
});

describe('DELETE /api/recordings/:id', () => {
  it('removes the blob and document, nulls audioId and keeps transcript and metrics', async () => {
    const { agent } = await signUp(app, freshEmail());
    const { attemptId, audioId } = await recordOneTurn(agent);
    expect(await blobExists(audioId)).toBe(true);

    const res = await agent.delete(`/api/recordings/${audioId}`);
    expect(res.status).toBe(204);
    expect(await blobExists(audioId)).toBe(false);
    expect(await RecordingModel.countDocuments({ _id: audioId })).toBe(0);

    const detail = await agent.get(`/api/attempts/${attemptId}`);
    expect(detail.status).toBe(200);
    const turn = (detail.body as AttemptDetailResponse).attempt.turns[0];
    expect(turn?.audioId).toBeNull();
    expect(turn?.transcript).not.toBe('');
    expect(turn?.words.length).toBeGreaterThan(0);

    expect((await agent.get(`/api/recordings/${audioId}/audio`)).status).toBe(404);
    expect((await agent.delete(`/api/recordings/${audioId}`)).status).toBe(404);
  });

  it('returns 404 for another user\'s recording and leaves it intact', async () => {
    const owner = await signUp(app, freshEmail());
    const intruder = await signUp(app, freshEmail());
    const { audioId } = await recordOneTurn(owner.agent);

    expect((await intruder.agent.delete(`/api/recordings/${audioId}`)).status).toBe(404);
    expect(await blobExists(audioId)).toBe(true);
    expect((await owner.agent.get('/api/recordings')).body).toMatchObject({ count: 1 });
  });

  it('nulls the baseline reference when the baseline recording is deleted', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    const userId = new Types.ObjectId(user.id);
    const recordingId = await putRecording({
      userId,
      kind: 'baseline',
      attemptId: null,
      turnIndex: null,
      mimeType: 'audio/webm',
      durationSec: 12,
      data: AUDIO_BYTES,
    });
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          baseline: {
            recordingId,
            transcript: 'kept',
            metrics: { wpm: 130, fillersPerMinute: 1, fillerCount: 1, longestPauseSec: 1, pauseCount2s: 0, durationSec: 12, wordCount: 26 },
            feedback: { strength: 'a', observation: 'b' },
            recordedAt: new Date(),
          },
        },
      },
    );
    expect((await agent.delete(`/api/recordings/${recordingId.toHexString()}`)).status).toBe(204);
    const stored = await UserModel.findById(userId).lean();
    expect(stored?.baseline?.recordingId).toBeNull();
    expect(stored?.baseline?.transcript).toBe('kept');
  });

  it('returns 404 for a malformed id', async () => {
    const { agent } = await signUp(app, freshEmail());
    expect((await agent.delete('/api/recordings/not-an-id')).status).toBe(404);
  });
});

describe('DELETE /api/account/recordings', () => {
  it('deletes every recording and blob for the user only, keeping attempts', async () => {
    const owner = await signUp(app, freshEmail());
    const other = await signUp(app, freshEmail());
    const first = await recordOneTurn(owner.agent);
    const second = await recordOneTurn(owner.agent);
    const theirs = await recordOneTurn(other.agent);

    const res = await owner.agent.delete('/api/account/recordings');
    expect(res.status).toBe(200);
    expect((res.body as DeleteAllRecordingsResponse).deletedCount).toBe(2);
    expect(await blobExists(first.audioId)).toBe(false);
    expect(await blobExists(second.audioId)).toBe(false);
    expect((await owner.agent.get('/api/recordings')).body).toMatchObject({ count: 0, totalBytes: 0, recordings: [] });

    const attempts = await AttemptModel.find({ userId: new Types.ObjectId(owner.user.id) }).lean();
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.turns[0]?.audioId).toBeNull();
      expect(attempt.turns[0]?.words.length).toBeGreaterThan(0);
    }

    expect(await blobExists(theirs.audioId)).toBe(true);
    expect((await other.agent.get('/api/recordings')).body).toMatchObject({ count: 1 });
  });

  it('requires a session', async () => {
    const { agent } = await signUp(app, freshEmail());
    await agent.post('/api/auth/signout');
    expect((await agent.delete('/api/account/recordings')).status).toBe(401);
    expect((await agent.get('/api/recordings')).status).toBe(401);
    expect((await agent.get('/api/attempts')).status).toBe(401);
  });
});

describe('GET /api/attempts (history)', () => {
  it('groups scored attempts by scenario with newest-first attempts, oldest-first trends and targets', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    const other = await signUp(app, freshEmail());
    await seedScored(user.id, { scenarioId: 'test-scenario', completedAt: '2026-11-01T10:00:00Z', wpm: 190, fillersPerMinute: 6.1, passedCount: 0 });
    await seedScored(user.id, { scenarioId: 'test-scenario', completedAt: '2026-11-03T10:00:00Z', wpm: 160, fillersPerMinute: 4, passedCount: 1 });
    const latest = await seedScored(user.id, { scenarioId: 'test-scenario', completedAt: '2026-11-05T10:00:00Z', wpm: 140, fillersPerMinute: 2.4, passedCount: 2 });
    await seedScored(user.id, { scenarioId: 'second-scenario', completedAt: '2026-11-04T10:00:00Z', wpm: 150, fillersPerMinute: 3, passedCount: 2 });
    await seedScored(user.id, { scenarioId: 'retired-scenario', completedAt: '2026-11-06T10:00:00Z', wpm: 150, fillersPerMinute: 3, passedCount: 2 });
    await seedScored(other.user.id, { scenarioId: 'test-scenario', completedAt: '2026-11-07T10:00:00Z', wpm: 99, fillersPerMinute: 9, passedCount: 0 });
    // An unfinished attempt never appears in history.
    await recordOneTurn(agent);

    const res = await agent.get('/api/attempts');
    expect(res.status).toBe(200);
    const { groups } = res.body as AttemptHistoryResponse;
    expect(groups.map((g) => g.scenario.id)).toEqual(['test-scenario', 'second-scenario']);

    const [first] = groups;
    expect(first?.attempts.map((a) => a.id)[0]).toBe(latest);
    expect(first?.attempts).toHaveLength(3);
    expect(first?.trend.wpm).toEqual([190, 160, 140]);
    expect(first?.trend.fillersPerMinute).toEqual([6.1, 4, 2.4]);
    expect(first?.targets).toEqual({ wpm: { op: 'between', value: [110, 170] } });
    expect(first?.attempts[0]).toMatchObject({ passed: true, passedCount: 2, totalCount: 2 });
    expect(JSON.stringify(res.body)).not.toContain('secret words');
  });

  it('filters by scenarioId and rejects a malformed filter', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    await seedScored(user.id, { scenarioId: 'test-scenario', completedAt: '2026-11-01T10:00:00Z', wpm: 150, fillersPerMinute: 2, passedCount: 2 });
    await seedScored(user.id, { scenarioId: 'second-scenario', completedAt: '2026-11-02T10:00:00Z', wpm: 150, fillersPerMinute: 2, passedCount: 2 });

    const filtered = await agent.get('/api/attempts').query({ scenarioId: 'second-scenario' });
    expect((filtered.body as AttemptHistoryResponse).groups.map((g) => g.scenario.id)).toEqual(['second-scenario']);
    expect((await agent.get('/api/attempts').query({ scenarioId: 'Bad Id!' })).status).toBe(400);
  });

  it('returns no groups before any scored attempt', async () => {
    const { agent } = await signUp(app, freshEmail());
    expect((await agent.get('/api/attempts')).body).toEqual({ groups: [] });
  });
});
