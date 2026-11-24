import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scenarioSchema,
  SKIP_AFTER_ATTEMPTS,
  type ApiErrorBody,
  type PathView,
  type AttemptDetailResponse,
  type ScenarioDetailResponse,
  type SkipResponse,
  type StartAttemptResponse,
  type Word,
} from '@rehearsal/shared';
import { createApp } from '../src/app';
import { createScenarioStore } from '../src/content/loadScenarios';
import { loadPathView } from '../src/paths/pathView';
import { isJudgeRunning, STALE_SCORING_MS } from '../src/attempts/judge';
import { AttemptModel, PathModel, ProgressModel, RecordingModel, UserModel } from '../src/models';
import { signUp, TEST_PASSWORD, type TestAgent } from './authHelper';
import { validScenario } from './fixtures';

/** Gating, attempt counting, skip and path completion through the real routes (spec/scoring.md "Gating"). */

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  generateTurnLine: vi.fn(),
  judgeAttempt: vi.fn(),
}));

vi.mock('../src/services/groq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/groq')>()),
  transcribe: mocks.transcribe,
  synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('RIFFwav')),
}));

vi.mock('../src/services/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/claude')>()),
  generateTurnLine: mocks.generateTurnLine,
  judgeAttempt: mocks.judgeAttempt,
}));

// Each test drives several attempts through bcrypt sign-up, uploads and the background judge.
vi.setConfig({ testTimeout: 60_000 });

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/rehearsal_test_gating';
const POLL_INTERVAL_MS = 25;
const POLL_ATTEMPTS = 120;
const PATH_IDS = ['p-one', 'p-two', 'p-three'] as const;
const EXPLORE_ID = 'explore-only';

const store = createScenarioStore(
  [...PATH_IDS, EXPLORE_ID].map((id) => scenarioSchema.parse({ ...validScenario(id), title: `Scenario ${id}` })),
);
const app = createApp({ scenarios: () => store, dbStatus: () => 'up' });

let counter = 0;

/** 150 wpm, no long pauses: the pace criterion passes. */
function steadySpeech(): Word[] {
  return Array.from({ length: 40 }, (_, i) => ({ word: `word${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));
}

/** 60 wpm: the pace criterion fails. */
function slowSpeech(): Word[] {
  return Array.from({ length: 20 }, (_, i) => ({ word: `word${i}`, start: i, end: i + 0.3 }));
}

/** Pass = both criteria met; miss = pace and structure both missed (more than one miss fails). */
function arrangeOutcome(pass: boolean): void {
  const words = pass ? steadySpeech() : slowSpeech();
  mocks.transcribe.mockResolvedValue({
    transcript: words.map((w) => w.word).join(' '),
    words,
    meanAvgLogprob: -0.2,
    durationSec: words.at(-1)?.end ?? 1,
  });
  mocks.judgeAttempt.mockResolvedValue({
    criteria: [{ id: 'structure', passed: pass }],
    evidence: 'You said word1.',
    nextAction: 'Lead with the main point.',
    fillerRulings: [],
  });
}

async function newUser(): Promise<{ agent: TestAgent; userId: Types.ObjectId }> {
  counter += 1;
  const { agent, user } = await signUp(app, `gating${counter}@test.local`);
  return { agent, userId: new Types.ObjectId(user.id) };
}

async function givePath(userId: Types.ObjectId, ids: readonly string[] = PATH_IDS): Promise<void> {
  await PathModel.create({ userId, scenarioIds: [...ids] });
  await ProgressModel.create({ userId, scenarioId: ids[0], status: 'available', unlockedAt: new Date() });
}

async function pollScored(agent: TestAgent, attemptId: string): Promise<AttemptDetailResponse> {
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    const body = (await agent.get(`/api/attempts/${attemptId}`)).body as AttemptDetailResponse;
    if (body.attempt.status === 'scored') return body;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('attempt was never scored');
}

/** Start, answer, finalize and wait for the verdict. */
async function runAttempt(agent: TestAgent, scenarioId: string, pass: boolean): Promise<AttemptDetailResponse> {
  arrangeOutcome(pass);
  const start = await agent.post('/api/attempts').send({ scenarioId, userInputs: {} });
  // 200 when an unanswered brief attempt from the same session is reused.
  expect([200, 201]).toContain(start.status);
  const { attemptId } = start.body as StartAttemptResponse;
  const upload = await agent
    .post(`/api/attempts/${attemptId}/turns/0/answer`)
    .field('durationSec', '16')
    .attach('audio', Buffer.from('0123456789abcdefghij'), { filename: 'take.webm', contentType: 'audio/webm' });
  expect(upload.status).toBe(200);
  expect((await agent.post(`/api/attempts/${attemptId}/finalize`)).status).toBe(202);
  // The first 'scored' response must already carry the updated gating state.
  const scored = await pollScored(agent, attemptId);
  expect(scored.attempt.verdict?.passed).toBe(pass);
  return scored;
}

async function getPath(userId: Types.ObjectId): Promise<PathView> {
  const view = await loadPathView(userId, store);
  if (!view) throw new Error('no path');
  return view;
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
  mocks.generateTurnLine.mockResolvedValue('Tell me about yourself.');
});

describe('unlocking and attempt counting', () => {
  it('unlocks the next item only when the current one passes', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    expect((await getPath(userId)).items.map((i) => i.state)).toEqual(['available', 'locked', 'locked']);

    const miss = await runAttempt(agent, 'p-one', false);
    expect(miss.progress).toMatchObject({ status: 'failed', attemptCount: 1, canSkip: false, onPath: true, nextScenarioId: 'p-two' });
    expect((await getPath(userId)).items.map((i) => i.state)).toEqual(['failed', 'locked', 'locked']);

    const pass = await runAttempt(agent, 'p-one', true);
    expect(pass.progress).toMatchObject({ status: 'passed', attemptCount: 2, canSkip: false });
    const path = await getPath(userId);
    expect(path.items.map((i) => i.state)).toEqual(['passed', 'available', 'locked']);
    expect(path.items[1]?.isCurrent).toBe(true);
    const next = await ProgressModel.findOne({ userId, scenarioId: 'p-two' }).lean();
    expect(next?.unlockedAt).toBeInstanceOf(Date);
  });

  it('counts attempts at finalize only, so an abandoned attempt is not counted', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    arrangeOutcome(false);
    const start = await agent.post('/api/attempts').send({ scenarioId: 'p-one', userInputs: {} });
    expect(start.status).toBe(201);
    expect((await getPath(userId)).items[0]?.attemptCount).toBe(0);
    await runAttempt(agent, 'p-one', false);
    expect((await getPath(userId)).items[0]?.attemptCount).toBe(1);
  });

  it('does not double count a repeated finalize', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    const detail = await runAttempt(agent, 'p-one', false);
    expect((await agent.post(`/api/attempts/${detail.attempt.id}/finalize`)).status).toBe(200);
    expect((await getPath(userId)).items[0]?.attemptCount).toBe(1);
  });
});

describe('best attempt', () => {
  it('is the attempt with the highest passedCount, the latest on a tie', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    const miss = await runAttempt(agent, 'p-one', false);
    const firstPass = await runAttempt(agent, 'p-one', true);
    const secondPass = await runAttempt(agent, 'p-one', true);
    expect(miss.attempt.verdict?.passedCount).toBe(0);
    expect(firstPass.attempt.verdict?.passedCount).toBe(2);
    expect(secondPass.attempt.verdict?.passedCount).toBe(2);
    const progress = await ProgressModel.findOne({ userId, scenarioId: 'p-one' }).lean();
    expect(progress?.bestAttemptId?.toHexString()).toBe(secondPass.attempt.id);
    expect((await getPath(userId)).items[0]?.bestAttemptId).toBe(secondPass.attempt.id);

    // A later, worse attempt does not displace it.
    await runAttempt(agent, 'p-one', false);
    expect((await getPath(userId)).items[0]?.bestAttemptId).toBe(secondPass.attempt.id);
  });
});

describe('stale scoring', () => {
  it('re-judges an attempt stuck in scoring for over 60 s on the next GET, without counting it again', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    const scored = await runAttempt(agent, 'p-one', true);
    const id = new Types.ObjectId(scored.attempt.id);
    // Simulate a server restart mid-judge: the attempt is left in 'scoring' with no judge running.
    await AttemptModel.updateOne(
      { _id: id, userId },
      { $set: { status: 'scoring', scoringStartedAt: new Date(Date.now() - STALE_SCORING_MS - 1_000), completedAt: null } },
    );
    expect(isJudgeRunning(id)).toBe(false);
    const judgeCalls = mocks.judgeAttempt.mock.calls.length;

    const again = await pollScored(agent, scored.attempt.id);
    expect(again.attempt.verdict?.passed).toBe(true);
    expect(mocks.judgeAttempt.mock.calls.length).toBe(judgeCalls + 1);
    const progress = await ProgressModel.findOne({ userId, scenarioId: 'p-one' }).lean();
    expect(progress).toMatchObject({ status: 'passed', attemptCount: 1 });
  });

  it('does not re-judge an attempt that has been scoring for under 60 s', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    const scored = await runAttempt(agent, 'p-one', true);
    const id = new Types.ObjectId(scored.attempt.id);
    await AttemptModel.updateOne({ _id: id, userId }, { $set: { status: 'scoring', scoringStartedAt: new Date() } });
    const judgeCalls = mocks.judgeAttempt.mock.calls.length;
    const body = (await agent.get(`/api/attempts/${scored.attempt.id}`)).body as AttemptDetailResponse;
    expect(body.attempt.status).toBe('scoring');
    expect(mocks.judgeAttempt.mock.calls.length).toBe(judgeCalls);
  });
});

describe('account deletion during judging', () => {
  it('leaves no attempt, progress or path behind when the judge finishes after the account is deleted', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    arrangeOutcome(true);
    let releaseJudge: () => void = () => undefined;
    const judgeGate = new Promise<void>((resolve) => {
      releaseJudge = resolve;
    });
    mocks.judgeAttempt.mockImplementationOnce(async () => {
      await judgeGate;
      return { criteria: [{ id: 'structure', passed: true }], evidence: 'You said word1.', nextAction: 'Lead with it.', fillerRulings: [] };
    });
    const start = await agent.post('/api/attempts').send({ scenarioId: 'p-one', userInputs: {} });
    const { attemptId } = start.body as StartAttemptResponse;
    const upload = await agent
      .post(`/api/attempts/${attemptId}/turns/0/answer`)
      .field('durationSec', '16')
      .attach('audio', Buffer.from('0123456789abcdefghij'), { filename: 'take.webm', contentType: 'audio/webm' });
    expect(upload.status).toBe(200);
    expect((await agent.post(`/api/attempts/${attemptId}/finalize`)).status).toBe(202);
    const id = new Types.ObjectId(attemptId);
    expect(isJudgeRunning(id)).toBe(true);

    expect((await agent.delete('/api/account').send({ password: TEST_PASSWORD })).status).toBe(204);
    releaseJudge();
    for (let i = 0; i < POLL_ATTEMPTS && isJudgeRunning(id); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    expect(isJudgeRunning(id)).toBe(false);
    expect(await AttemptModel.countDocuments({ userId })).toBe(0);
    expect(await ProgressModel.countDocuments({ userId })).toBe(0);
    expect(await PathModel.countDocuments({ userId })).toBe(0);
    expect(await RecordingModel.countDocuments({ userId })).toBe(0);
  });
});

describe('reattempts', () => {
  it('a failed reattempt after a pass never downgrades the status', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    await runAttempt(agent, 'p-one', true);
    const again = await runAttempt(agent, 'p-one', false);
    expect(again.progress).toMatchObject({ status: 'passed', attemptCount: 2, canSkip: false });
    expect((await getPath(userId)).items.map((i) => i.state)).toEqual(['passed', 'available', 'locked']);
  });

  it('a failed reattempt after a skip keeps it skipped; a pass upgrades it to passed', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(agent, 'p-one', false);
    expect((await agent.post('/api/path/p-one/skip')).status).toBe(200);
    const miss = await runAttempt(agent, 'p-one', false);
    expect(miss.progress).toMatchObject({ status: 'skipped', canSkip: false });
    const pass = await runAttempt(agent, 'p-one', true);
    expect(pass.progress.status).toBe('passed');
    expect((await getPath(userId)).items.map((i) => i.state)).toEqual(['passed', 'available', 'locked']);
  });

  it('scenarios off the path can be attempted and never touch path progress', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    const detail = await runAttempt(agent, EXPLORE_ID, true);
    expect(detail.progress).toMatchObject({ onPath: false, nextScenarioId: null, canSkip: false, status: 'passed' });
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(agent, EXPLORE_ID, false);
    const off = (await agent.get(`/api/scenarios/${EXPLORE_ID}`)).body as ScenarioDetailResponse;
    expect(off.canSkip).toBe(false);
    expect((await getPath(userId)).items.map((i) => i.state)).toEqual(['available', 'locked', 'locked']);
    expect((await agent.post(`/api/path/${EXPLORE_ID}/skip`)).status).toBe(404);
  });

  it('a locked path item can be attempted early; it shows its result but is not skippable', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(agent, 'p-two', false);
    const items = (await getPath(userId)).items;
    expect(items[1]).toMatchObject({ state: 'locked', attemptCount: SKIP_AFTER_ATTEMPTS, canSkip: false });
    const res = await agent.post('/api/path/p-two/skip');
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error.code).toBe('SKIP_NOT_ALLOWED');
  });
});

describe('POST /api/path/:scenarioId/skip', () => {
  it('rejects a skip before the third failed attempt', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    const fresh = await agent.post('/api/path/p-one/skip');
    expect(fresh.status).toBe(409);
    expect((fresh.body as ApiErrorBody).error.code).toBe('SKIP_NOT_ALLOWED');
    for (let i = 1; i < SKIP_AFTER_ATTEMPTS; i += 1) {
      const detail = await runAttempt(agent, 'p-one', false);
      expect(detail.progress.canSkip).toBe(false);
      expect((await agent.post('/api/path/p-one/skip')).status).toBe(409);
    }
  });

  it('allows a skip from the third failed attempt, marks it skipped and unlocks the next', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    let detail: AttemptDetailResponse | null = null;
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) detail = await runAttempt(agent, 'p-one', false);
    expect(detail?.progress).toMatchObject({ canSkip: true, attemptCount: SKIP_AFTER_ATTEMPTS });
    expect((await getPath(userId)).items[0]?.canSkip).toBe(true);

    const res = await agent.post('/api/path/p-one/skip');
    expect(res.status).toBe(200);
    const { path } = res.body as SkipResponse;
    expect(path?.items.map((i) => i.state)).toEqual(['skipped', 'available', 'locked']);
    expect(path?.items[1]?.isCurrent).toBe(true);
    expect(path?.clearedCount).toBe(1);
    expect(path?.complete).toBe(false);

    const twice = await agent.post('/api/path/p-one/skip');
    expect(twice.status).toBe(409);
  });

  it('rejects skipping a passed item', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(agent, 'p-one', false);
    await runAttempt(agent, 'p-one', true);
    expect((await agent.post('/api/path/p-one/skip')).status).toBe(409);
  });

  it('404s a scenario not on the path, an unknown id, a malformed id, and a user without a path', async () => {
    const { agent, userId } = await newUser();
    expect((await agent.post('/api/path/p-one/skip')).status).toBe(404);
    await givePath(userId);
    expect((await agent.post('/api/path/nope/skip')).status).toBe(404);
    expect((await agent.post('/api/path/Not_Valid!/skip')).status).toBe(404);
  });

  it('requires a session and is scoped to the caller', async () => {
    expect((await request(app).post('/api/path/p-one/skip')).status).toBe(401);
    const owner = await newUser();
    await givePath(owner.userId);
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(owner.agent, 'p-one', false);
    const other = await newUser();
    await givePath(other.userId);
    expect((await other.agent.post('/api/path/p-one/skip')).status).toBe(409);
    expect((await getPath(owner.userId)).items[0]?.state).toBe('failed');
  });
});

describe('path completion', () => {
  it('sets completedAt when every item is passed or skipped, by pass or by skip', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId);
    await runAttempt(agent, 'p-one', true);
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(agent, 'p-two', false);
    await agent.post('/api/path/p-two/skip');
    let path = await getPath(userId);
    expect(path.completedAt).toBeNull();
    expect(path.complete).toBe(false);

    await runAttempt(agent, 'p-three', true);
    path = await getPath(userId);
    expect(path.complete).toBe(true);
    expect(path.clearedCount).toBe(3);
    expect(path.completedAt).not.toBeNull();
    const stamped = path.completedAt;

    // A later reattempt keeps the path complete and the original timestamp.
    await runAttempt(agent, 'p-one', false);
    path = await getPath(userId);
    expect(path.complete).toBe(true);
    expect(path.completedAt).toBe(stamped);
  });

  it('completes when the last item is skipped', async () => {
    const { agent, userId } = await newUser();
    await givePath(userId, ['p-one', 'p-two']);
    await runAttempt(agent, 'p-one', true);
    for (let i = 0; i < SKIP_AFTER_ATTEMPTS; i += 1) await runAttempt(agent, 'p-two', false);
    const res = await agent.post('/api/path/p-two/skip');
    const { path } = res.body as SkipResponse;
    expect(path?.complete).toBe(true);
    expect(path?.completedAt).not.toBeNull();
  });
});
