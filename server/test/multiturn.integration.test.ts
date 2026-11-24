import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scenarioSchema,
  type ApiErrorBody,
  type AttemptDetailResponse,
  type GenerateTurnResponse,
  type StartAttemptResponse,
  type UploadAnswerResponse,
  type Word,
} from '@rehearsal/shared';
import { createApp } from '../src/app';
import { createScenarioStore } from '../src/content/loadScenarios';
import { AttemptModel, PathModel, ProgressModel, RecordingModel, UserModel } from '../src/models';
import { signUp, type TestAgent } from './authHelper';
import { validScenario } from './fixtures';

/** Phase 5: a 4-turn scenario mixing independent and answer-dependent turns, driven like the live screen. */

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), generateTurnLine: vi.fn(), judgeAttempt: vi.fn() }));

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

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/rehearsal_test_multiturn';
const RESPONSE = { maxSeconds: 60, minSeconds: 5, silenceStopSeconds: 3 };
const base = validScenario('four-turn');
const turn = (index: number, dependsOnPreviousAnswer: boolean) => ({
  index,
  speaker: 'ai' as const,
  persona: 'An interviewer.',
  generate: `Question ${index}.`,
  dependsOnPreviousAnswer,
  userResponse: RESPONSE,
});
const store = createScenarioStore([
  scenarioSchema.parse({ ...base, turns: [turn(0, false), turn(1, false), turn(2, true), turn(3, false)] }),
]);
const app = createApp({ scenarios: () => store, dbStatus: () => 'up' });
let agent: TestAgent;

function words(): Word[] {
  return Array.from({ length: 40 }, (_, i) => ({ word: `word${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));
}

const answer = (attemptId: string, index: number) =>
  agent
    .post(`/api/attempts/${attemptId}/turns/${index}/answer`)
    .field('durationSec', '16')
    .attach('audio', Buffer.from('0123456789abcdefghij'), { filename: 'take.webm', contentType: 'audio/webm' });

const generate = (attemptId: string, index: number) => agent.post(`/api/attempts/${attemptId}/turns/${index}/generate`);

beforeAll(async () => {
  await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();
  await Promise.all([UserModel.init(), AttemptModel.init(), ProgressModel.init(), PathModel.init(), RecordingModel.init()]);
  agent = (await signUp(app, 'multi@test.local')).agent;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  mocks.generateTurnLine.mockImplementation(async () => {
    n += 1;
    return `Line ${n}.`;
  });
  const w = words();
  mocks.transcribe.mockResolvedValue({ transcript: w.map((x) => x.word).join(' '), words: w, meanAvgLogprob: -0.2, durationSec: 16 });
  mocks.judgeAttempt.mockResolvedValue({ criteria: [{ id: 'structure', passed: true }], evidence: 'e', nextAction: 'n', fillerRulings: [] });
});

describe('four-turn scenario', () => {
  it('pre-generates independent turns during the answer, waits for dependent ones, and finalizes', async () => {
    const start = await agent.post('/api/attempts').send({ scenarioId: 'four-turn', userInputs: {} });
    const { attemptId } = start.body as StartAttemptResponse;

    // While answering turn 0, turn 1 (independent) can be prepared ahead, idempotently.
    const pre = await generate(attemptId, 1);
    expect(pre.status).toBe(200);
    expect((await generate(attemptId, 1)).body).toEqual(pre.body as GenerateTurnResponse);
    // Turns are generated in order.
    const skipAhead = await generate(attemptId, 3);
    expect((skipAhead.body as ApiErrorBody).error.code).toBe('TURN_OUT_OF_ORDER');

    expect((await answer(attemptId, 0)).status).toBe(200);
    // Turn 2 follows on from turn 1's answer: not before it exists.
    const early = await generate(attemptId, 2);
    expect(early.status).toBe(409);
    expect((early.body as ApiErrorBody).error.code).toBe('PREVIOUS_ANSWER_REQUIRED');

    expect((await answer(attemptId, 1)).status).toBe(200);
    expect((await generate(attemptId, 2)).status).toBe(200);
    // Turn 3 is independent: prepared while turn 2 is answered.
    expect((await generate(attemptId, 3)).status).toBe(200);
    expect((await answer(attemptId, 2)).status).toBe(200);

    expect((await agent.post(`/api/attempts/${attemptId}/finalize`)).status).toBe(409);

    // Retrying a turn replaces it without touching earlier turns.
    expect((await answer(attemptId, 2)).status).toBe(200);
    const last = await answer(attemptId, 3);
    expect((last.body as UploadAnswerResponse).allTurnsAnswered).toBe(true);

    const fin = await agent.post(`/api/attempts/${attemptId}/finalize`);
    expect(fin.status).toBe(202);
    const detail = fin.body as AttemptDetailResponse;
    expect(detail.attempt.turns.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    expect(new Set(detail.attempt.turns.map((t) => t.aiText)).size).toBe(4);
    expect(await RecordingModel.countDocuments({ attemptId })).toBe(4);
  });
});
