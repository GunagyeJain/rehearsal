import { describe, expect, it, vi } from 'vitest';
import {
  TranscriptionError,
  UpstreamError,
  createGroqService,
  parseTranscription,
  retryDelayMs,
  ttsCacheKey,
  type GroqAudioClient,
} from '../src/services/groq';

const goodResponse = {
  text: 'So um I built a thing.',
  duration: 2.4,
  words: [
    { word: 'So', start: 0.1, end: 0.3 },
    { word: 'um', start: 0.5, end: 0.7 },
    { word: 'I', start: 0.9, end: 1.0 },
  ],
  segments: [{ avg_logprob: -0.1, no_speech_prob: 0.01 }],
};

function fakeClient(overrides: Partial<{ transcribe: () => Promise<unknown>; speech: () => Promise<ArrayBuffer> }> = {}) {
  const transcribe = vi.fn(overrides.transcribe ?? (async () => goodResponse));
  const speech = vi.fn(overrides.speech ?? (async () => new Uint8Array([1, 2, 3]).buffer));
  const client: GroqAudioClient = {
    audio: {
      transcriptions: { create: transcribe },
      speech: { create: async () => ({ arrayBuffer: speech }) },
    },
  };
  return { client, transcribe, speech };
}

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`status ${status}`), { status });
}

describe('parseTranscription', () => {
  it('returns words and confidence for a clean take', () => {
    const result = parseTranscription(goodResponse);
    expect(result.words).toHaveLength(3);
    expect(result.meanAvgLogprob).toBeCloseTo(-0.1);
    expect(result.confidence.segmentCount).toBe(1);
    expect(result.durationSec).toBe(2.4);
  });

  it('throws MISSING_TIMESTAMPS when words are absent but text exists', () => {
    expect(() => parseTranscription({ ...goodResponse, words: undefined })).toThrow(TranscriptionError);
    try {
      parseTranscription({ ...goodResponse, words: undefined });
    } catch (e) {
      expect((e as TranscriptionError).code).toBe('MISSING_TIMESTAMPS');
      expect((e as TranscriptionError).status).toBe(422);
    }
  });

  it('throws MISSING_TIMESTAMPS when one word lacks a start', () => {
    const words = [{ word: 'So', end: 0.3 }, ...goodResponse.words.slice(1)];
    expect(() => parseTranscription({ ...goodResponse, words })).toThrow(/without timings/);
  });

  it('throws NO_SPEECH for an empty transcript', () => {
    expect(() => parseTranscription({ text: '', words: [], segments: [] })).toThrow(
      expect.objectContaining({ code: 'NO_SPEECH' }),
    );
  });

  it('throws TRANSCRIPT_UNRELIABLE below the avg_logprob gate', () => {
    const segments = [{ avg_logprob: -0.5 }, { avg_logprob: -0.9 }];
    expect(() => parseTranscription({ ...goodResponse, segments })).toThrow(
      expect.objectContaining({ code: 'TRANSCRIPT_UNRELIABLE' }),
    );
  });

  it('accepts a take just above the gate', () => {
    const segments = [{ avg_logprob: -0.55 }, { avg_logprob: -0.6 }];
    expect(parseTranscription({ ...goodResponse, segments }).meanAvgLogprob).toBeCloseTo(-0.575);
  });
});

describe('createGroqService.transcribe', () => {
  it('sends whisper-large-v3-turbo with word and segment timestamps and no prompt', async () => {
    const { client, transcribe } = fakeClient();
    await createGroqService({ client, ttsCacheDir: null }).transcribe(Buffer.from('x'), 'audio/webm;codecs=opus');
    const params = (transcribe.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe('whisper-large-v3-turbo');
    expect(params.response_format).toBe('verbose_json');
    expect(params.timestamp_granularities).toEqual(['word', 'segment']);
    expect(params).not.toHaveProperty('prompt');
  });

  it('retries once on a 5xx and then succeeds', async () => {
    let calls = 0;
    const { client } = fakeClient({
      transcribe: async () => {
        calls += 1;
        if (calls === 1) throw apiError(502);
        return goodResponse;
      },
    });
    const result = await createGroqService({ client, ttsCacheDir: null }).transcribe(Buffer.from('x'), 'audio/webm');
    expect(result.words).toHaveLength(3);
    expect(calls).toBe(2);
  });

  it('throws UpstreamError after two 429s, waiting before the retry', async () => {
    const { client, transcribe } = fakeClient({ transcribe: async () => Promise.reject(apiError(429)) });
    const sleep = vi.fn(async () => undefined);
    await expect(
      createGroqService({ client, ttsCacheDir: null, sleep }).transcribe(Buffer.from('x'), 'audio/webm'),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('recovers TTS from a 429 after the wait', async () => {
    let calls = 0;
    const client: GroqAudioClient = {
      audio: {
        transcriptions: { create: async () => goodResponse },
        speech: {
          create: async () => {
            calls += 1;
            if (calls === 1) throw apiError(429);
            return { arrayBuffer: async () => new Uint8Array([7]).buffer };
          },
        },
      },
    };
    const sleep = vi.fn(async () => undefined);
    const audio = await createGroqService({ client, ttsCacheDir: null, sleep }).synthesizeSpeech('Hi.');
    expect(audio.length).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400', async () => {
    const { client, transcribe } = fakeClient({ transcribe: async () => Promise.reject(apiError(400)) });
    await expect(createGroqService({ client, ttsCacheDir: null }).transcribe(Buffer.from('x'), 'audio/webm')).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('retryDelayMs', () => {
  it('waits only on 429, honouring retry-after within bounds', () => {
    expect(retryDelayMs(apiError(502))).toBe(0);
    expect(retryDelayMs(apiError(429))).toBe(1000);
    expect(retryDelayMs(Object.assign(apiError(429), { headers: new Headers({ 'retry-after': '0.5' }) }))).toBe(500);
    expect(retryDelayMs(Object.assign(apiError(429), { headers: { 'retry-after': '60' } }))).toBe(2000);
    expect(retryDelayMs(Object.assign(apiError(429), { headers: { 'retry-after': '0.01' } }))).toBe(250);
  });
});

describe('createGroqService.synthesizeSpeech', () => {
  it('caches by text so a repeat does not call Groq', async () => {
    const { client, speech } = fakeClient();
    const svc = createGroqService({ client, ttsCacheDir: null });
    const a = await svc.synthesizeSpeech('Hello there.');
    const b = await svc.synthesizeSpeech('Hello there.');
    expect(a.equals(b)).toBe(true);
    expect(speech).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry when full', async () => {
    const { client, speech } = fakeClient();
    const svc = createGroqService({ client, ttsCacheDir: null, ttsCacheMaxEntries: 2 });
    await svc.synthesizeSpeech('one');
    await svc.synthesizeSpeech('two');
    await svc.synthesizeSpeech('three');
    await svc.synthesizeSpeech('one');
    expect(speech).toHaveBeenCalledTimes(4);
  });

  it('keys the cache on model, voice and text', () => {
    expect(ttsCacheKey('a')).not.toBe(ttsCacheKey('b'));
    expect(ttsCacheKey('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});
