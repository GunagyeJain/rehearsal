import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scenarioSchema,
  type ApiErrorBody,
  type AuthUserResponse,
  type ProfileResponse,
  type SettingsResponse,
  type StartAttemptResponse,
  type UploadAnswerResponse,
  type Word,
} from '@rehearsal/shared';
import { createApp } from '../src/app';
import { createScenarioStore } from '../src/content/loadScenarios';
import { getRecordingsBucket } from '../src/db';
import { putRecording } from '../src/storage/recordings';
import { AttemptModel, PathModel, ProgressModel, RecordingModel, UserModel } from '../src/models';
import { signUp, TEST_PASSWORD, type TestAgent } from './authHelper';
import { validScenario } from './fixtures';

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), generateTurnLine: vi.fn() }));

vi.mock('../src/services/groq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/groq')>()),
  transcribe: mocks.transcribe,
  synthesizeSpeech: vi.fn().mockRejectedValue(new Error('tts is not called in auth tests')),
}));

vi.mock('../src/services/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/claude')>()),
  generateTurnLine: mocks.generateTurnLine,
  judgeAttempt: vi.fn().mockResolvedValue(null),
}));

/** Separate database from the Phase 2 suite: vitest runs files in parallel and both drop their DB. */
const TEST_DB_URI = 'mongodb://127.0.0.1:27017/rehearsal_test_auth';
const GENEROUS_LIMIT = { windowMs: 60_000, limit: 10_000 };
const AUDIO_BYTES = Buffer.from('fake-audio-bytes');
const BCRYPT_COST_12_PREFIX = /^\$2[aby]\$12\$/;

const store = createScenarioStore([scenarioSchema.parse(validScenario())]);
const app = createApp({ scenarios: () => store, dbStatus: () => 'up', authRateLimit: GENEROUS_LIMIT });

function speech(count = 40): Word[] {
  return Array.from({ length: count }, (_, i) => ({ word: `word${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));
}

function sessionCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith('rehearsal_session='));
}

let emailCounter = 0;
function freshEmail(): string {
  emailCounter += 1;
  return `user${emailCounter}@test.local`;
}

/** Start an attempt and upload turn 0, so the user owns an attempt and a GridFS recording. */
async function recordOneTurn(agent: TestAgent): Promise<{ attemptId: string; audioId: string }> {
  const start = await agent.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} });
  expect(start.status).toBe(201);
  const attemptId = (start.body as StartAttemptResponse).attemptId;
  const upload = await agent
    .post(`/api/attempts/${attemptId}/turns/0/answer`)
    .field('durationSec', '16')
    .attach('audio', AUDIO_BYTES, { filename: 'take.webm', contentType: 'audio/webm' });
  expect(upload.status).toBe(200);
  const audioId = (upload.body as UploadAnswerResponse).turn.audioId;
  if (!audioId) throw new Error('upload returned no audio id');
  return { attemptId, audioId };
}

async function gridFsCount(userId: Types.ObjectId): Promise<number> {
  return (await getRecordingsBucket().find({ 'metadata.userId': userId }).toArray()).length;
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

describe('POST /api/auth/signup', () => {
  it('creates the user with default settings, a cost-12 hash and an httpOnly Lax session cookie', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: '  New.Person@Example.COM ', password: TEST_PASSWORD });
    expect(res.status).toBe(201);
    const { user } = res.body as AuthUserResponse;
    expect(user).toMatchObject({
      email: 'new.person@example.com',
      profile: null,
      onboarded: false,
      settings: { theme: 'system', font: 'serif', showTranscript: true },
    });
    expect(user).not.toHaveProperty('passwordHash');

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i);

    const stored = await UserModel.findOne({ email: 'new.person@example.com' }).lean();
    expect(stored?.passwordHash).toMatch(BCRYPT_COST_12_PREFIX);
  });

  it('rejects an invalid email or a short password with field errors', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    const body = res.body as ApiErrorBody;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toHaveProperty('email');
    expect(body.error.fields).toHaveProperty('password');
  });

  it('returns 409 EMAIL_TAKEN for an existing email in any case', async () => {
    const email = freshEmail();
    await signUp(app, email);
    const res = await request(app).post('/api/auth/signup').send({ email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(409);
    expect((res.body as ApiErrorBody).error.code).toBe('EMAIL_TAKEN');
    expect(await UserModel.countDocuments({ email })).toBe(1);
  });
});

describe('sign in, me, sign out', () => {
  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const email = freshEmail();
    await signUp(app, email);
    const wrong = await request(app).post('/api/auth/signin').send({ email, password: 'wrong password here' });
    const unknown = await request(app).post('/api/auth/signin').send({ email: 'nobody@test.local', password: TEST_PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      const body = res.body as ApiErrorBody;
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
      expect(body.error.message).toBe('Email or password is incorrect.');
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it('signs in, reads me, signs out, and is unauthenticated afterwards', async () => {
    const email = freshEmail();
    await signUp(app, email);
    const agent = request.agent(app);
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const signin = await agent.post('/api/auth/signin').send({ email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(signin.status).toBe(200);
    expect(sessionCookie(signin)).toBeDefined();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect((me.body as AuthUserResponse).user.email).toBe(email);
    expect((await agent.get('/api/users/me')).status).toBe(200);

    const out = await agent.post('/api/auth/signout');
    expect(out.status).toBe(204);
    expect(sessionCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect((after.body as ApiErrorBody).error.code).toBe('UNAUTHENTICATED');
  });

  it('rate limits the auth routes', async () => {
    const limited = createApp({ scenarios: () => store, dbStatus: () => 'up', authRateLimit: { windowMs: 60_000, limit: 2 } });
    const body = { email: 'nobody@test.local', password: TEST_PASSWORD };
    await request(limited).post('/api/auth/signin').send(body);
    await request(limited).post('/api/auth/signin').send(body);
    const third = await request(limited).post('/api/auth/signin').send(body);
    expect(third.status).toBe(429);
    expect((third.body as ApiErrorBody).error.code).toBe('RATE_LIMITED');
  });

  it('does not rate limit GET /api/auth/me, which runs on every page load', async () => {
    const limited = createApp({ scenarios: () => store, dbStatus: () => 'up', authRateLimit: { windowMs: 60_000, limit: 2 } });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await request(limited).get('/api/auth/me')).status);
    expect(statuses).toEqual([401, 401, 401, 401]);
  });
});

describe('users routes', () => {
  it('patches settings strictly and returns the merged settings', async () => {
    const { agent } = await signUp(app, freshEmail());
    const res = await agent.patch('/api/users/me/settings').send({ theme: 'dark' });
    expect(res.status).toBe(200);
    expect((res.body as SettingsResponse).settings).toEqual({ theme: 'dark', font: 'serif', showTranscript: true });
    expect((await agent.patch('/api/users/me/settings').send({ colour: 'red' })).status).toBe(400);
    expect((await agent.patch('/api/users/me/settings').send({ font: 'comic' })).status).toBe(400);
    const me = (await agent.get('/api/auth/me')).body as AuthUserResponse;
    expect(me.user.settings.theme).toBe('dark');
  });

  it('requires a profile before patching it and re-validates the merged profile', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    const early = await agent.patch('/api/users/me/profile').send({ field: 'Design' });
    expect(early.status).toBe(409);
    expect((early.body as ApiErrorBody).error.code).toBe('PROFILE_REQUIRED');

    await UserModel.updateOne(
      { _id: user.id },
      { $set: { profile: { goal: 'job-interview', goalDetail: '', timeframe: 'this-month', field: 'Software', confidence: 3 } } },
    );
    const ok = await agent.patch('/api/users/me/profile').send({ field: 'Data engineering', confidence: 4 });
    expect(ok.status).toBe(200);
    expect((ok.body as ProfileResponse).profile).toMatchObject({ goal: 'job-interview', field: 'Data engineering', confidence: 4 });

    const other = await agent.patch('/api/users/me/profile').send({ goal: 'other' });
    expect(other.status).toBe(400);
    expect((other.body as ApiErrorBody).error.fields).toHaveProperty('goalDetail');
  });
});

describe('cross-user isolation', () => {
  it('hides one users attempts and recordings from another', async () => {
    const a = await signUp(app, freshEmail());
    const b = await signUp(app, freshEmail());
    const { attemptId, audioId } = await recordOneTurn(a.agent);

    expect((await a.agent.get(`/api/attempts/${attemptId}`)).status).toBe(200);
    expect((await a.agent.get(`/api/recordings/${audioId}/audio`)).status).toBe(200);
    expect((await b.agent.get(`/api/attempts/${attemptId}`)).status).toBe(404);
    expect((await b.agent.post(`/api/attempts/${attemptId}/finalize`)).status).toBe(404);
    expect((await b.agent.get(`/api/recordings/${audioId}/audio`)).status).toBe(404);
    const upload = await b.agent
      .post(`/api/attempts/${attemptId}/turns/0/answer`)
      .field('durationSec', '3')
      .attach('audio', AUDIO_BYTES, { filename: 'take.webm', contentType: 'audio/webm' });
    expect(upload.status).toBe(404);
  });
});

describe('DELETE /api/account', () => {
  it('refuses a wrong password and keeps the account', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    const res = await agent.delete('/api/account').send({ password: 'not my password' });
    expect(res.status).toBe(401);
    expect((res.body as ApiErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    expect(await UserModel.exists({ _id: user.id })).not.toBeNull();
  });

  it('removes the user, attempts, progress, path, recordings and GridFS blobs, and nobody elses', async () => {
    const doomed = await signUp(app, freshEmail());
    const keeper = await signUp(app, freshEmail());
    const doomedId = new Types.ObjectId(doomed.user.id);
    const keeperId = new Types.ObjectId(keeper.user.id);
    await recordOneTurn(doomed.agent);
    await recordOneTurn(doomed.agent);
    const kept = await recordOneTurn(keeper.agent);
    await PathModel.create({ userId: doomedId, scenarioIds: ['test-scenario'] });
    await ProgressModel.create({ userId: doomedId, scenarioId: 'test-scenario', status: 'available' });
    // A blob whose metadata document was never written (an upload that died half way).
    await new Promise<void>((resolve, reject) => {
      const upload = getRecordingsBucket().openUploadStream('orphan', { metadata: { userId: doomedId } });
      upload.once('error', reject);
      upload.once('finish', () => resolve());
      upload.end(AUDIO_BYTES);
    });
    expect(await gridFsCount(doomedId)).toBe(3);

    const res = await doomed.agent.delete('/api/account').send({ password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);

    expect(await UserModel.exists({ _id: doomedId })).toBeNull();
    expect(await AttemptModel.countDocuments({ userId: doomedId })).toBe(0);
    expect(await ProgressModel.countDocuments({ userId: doomedId })).toBe(0);
    expect(await PathModel.countDocuments({ userId: doomedId })).toBe(0);
    expect(await RecordingModel.countDocuments({ userId: doomedId })).toBe(0);
    expect(await gridFsCount(doomedId)).toBe(0);

    expect(await UserModel.exists({ _id: keeperId })).not.toBeNull();
    expect(await RecordingModel.countDocuments({ userId: keeperId })).toBe(1);
    expect(await gridFsCount(keeperId)).toBe(1);
    expect((await keeper.agent.get(`/api/recordings/${kept.audioId}/audio`)).status).toBe(200);
  });

  it('rejects a still-valid token once its account is gone', async () => {
    const email = freshEmail();
    const { agent } = await signUp(app, email);
    const signin = await request(app).post('/api/auth/signin').send({ email, password: TEST_PASSWORD });
    const oldCookie = sessionCookie(signin)?.split(';')[0] ?? '';
    expect((await agent.delete('/api/account').send({ password: TEST_PASSWORD })).status).toBe(204);
    const replay = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
  });
});

describe('session revocation, sign-in throttle, CSRF guard and password bytes', () => {
  it('revokes copies of the token on sign-out, and a fresh sign-in works again', async () => {
    const email = freshEmail();
    await signUp(app, email);
    const signin = await request(app).post('/api/auth/signin').send({ email, password: TEST_PASSWORD });
    const copied = sessionCookie(signin)?.split(';')[0] ?? '';
    expect((await request(app).get('/api/auth/me').set('Cookie', copied)).status).toBe(200);
    expect((await request(app).post('/api/auth/signout').set('Cookie', copied)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', copied)).status).toBe(401);
    const again = await request(app).post('/api/auth/signin').send({ email, password: TEST_PASSWORD });
    const fresh = sessionCookie(again)?.split(';')[0] ?? '';
    expect((await request(app).get('/api/auth/me').set('Cookie', fresh)).status).toBe(200);
  });

  // Twelve cost-12 bcrypt runs: well past the default 5 s timeout.
  it('locks one email after 10 failed sign-ins, even with the right password, without touching others', async () => {
    const email = freshEmail();
    await signUp(app, email);
    for (let i = 0; i < 10; i += 1) {
      expect((await request(app).post('/api/auth/signin').send({ email, password: 'wrong password' })).status).toBe(401);
    }
    const locked = await request(app).post('/api/auth/signin').send({ email, password: TEST_PASSWORD });
    expect(locked.status).toBe(429);
    expect((locked.body as ApiErrorBody).error.code).toBe('RATE_LIMITED');
    const other = freshEmail();
    await signUp(app, other);
    expect((await request(app).post('/api/auth/signin').send({ email: other, password: TEST_PASSWORD })).status).toBe(200);
  }, 60_000);

  it('rejects cross-origin mutations and non-JSON bodies before any handler runs', async () => {
    const { agent } = await signUp(app, freshEmail());
    const crossSite = await agent.post('/api/auth/signout').set('Sec-Fetch-Site', 'same-site');
    expect(crossSite.status).toBe(403);
    expect((crossSite.body as ApiErrorBody).error.code).toBe('FORBIDDEN');
    const foreignOrigin = await agent.patch('/api/users/me/settings').set('Origin', 'http://localhost:9999').send({ theme: 'dark' });
    expect(foreignOrigin.status).toBe(403);
    const form = await agent.post('/api/attempts').type('form').send('scenarioId=test-scenario');
    expect(form.status).toBe(415);
    const multipartElsewhere = await agent.post('/api/attempts').field('scenarioId', 'test-scenario');
    expect(multipartElsewhere.status).toBe(415);
    const sameOrigin = await agent
      .patch('/api/users/me/settings')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ theme: 'dark' });
    expect(sameOrigin.status).toBe(200);
  });

  it('rejects a password longer than 72 UTF-8 bytes at sign-up', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: freshEmail(), password: 'é'.repeat(40) });
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.fields).toHaveProperty('password');
  });

  it('drops an upload that finishes after account deletion started', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    const userId = new Types.ObjectId(user.id);
    await UserModel.updateOne({ _id: userId }, { $set: { deleting: true } });
    await expect(
      putRecording({
        userId,
        kind: 'attempt',
        attemptId: new Types.ObjectId(),
        turnIndex: 0,
        mimeType: 'audio/webm',
        durationSec: 3,
        data: AUDIO_BYTES,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await RecordingModel.countDocuments({ userId })).toBe(0);
    expect(await gridFsCount(userId)).toBe(0);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('drops a new attempt whose turn generation finishes after account deletion started', async () => {
    const { agent, user } = await signUp(app, freshEmail());
    const userId = new Types.ObjectId(user.id);
    mocks.generateTurnLine.mockImplementationOnce(async () => {
      // DELETE /api/account marks the user first; generation is still in flight.
      await UserModel.updateOne({ _id: userId }, { $set: { deleting: true } });
      return 'Hello. Please introduce yourself.';
    });
    const res = await agent.post('/api/attempts').send({ scenarioId: 'test-scenario', userInputs: {} });
    expect(res.status).toBe(401);
    expect((res.body as ApiErrorBody).error.code).toBe('UNAUTHENTICATED');
    expect(await AttemptModel.countDocuments({ userId })).toBe(0);
  });
});
