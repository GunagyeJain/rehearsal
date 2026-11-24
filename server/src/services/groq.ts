import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Groq, { toFile } from 'groq-sdk';
import { z } from 'zod';
import { TRANSCRIPT_MIN_AVG_LOGPROB, type Word } from '@rehearsal/shared';
import { SERVER_ROOT } from '../config/env';
import { HttpError } from '../http/HttpError';

/** All Groq calls live here (spec/api.md, verified in spec/phase-0-spike.md). */
export const GROQ_MODELS = {
  stt: 'whisper-large-v3-turbo',
  tts: 'canopylabs/orpheus-v1-english',
} as const;

/** Lowercase only; the API rejects capitalised names. */
export const TTS_VOICE = 'autumn';

/** In-memory TTS cache size (spec/api.md `POST /api/tts`). */
export const TTS_CACHE_MAX_ENTRIES = 200;
/** Disk TTS cache cap; past it the least recently written files are evicted (spec/api.md `POST /api/tts`). */
export const TTS_DISK_CACHE_MAX_FILES = 2_000;

const DEFAULT_TTS_CACHE_DIR = path.join(SERVER_ROOT, '.data', 'tts-cache');
const GROQ_TIMEOUT_MS = 30_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
/** Wait before retrying a 429. Groq's Orpheus limit is per-minute tokens (resets in well under a second). */
const RATE_LIMIT_RETRY_DEFAULT_MS = 1_000;
const RATE_LIMIT_RETRY_MIN_MS = 250;
const RATE_LIMIT_RETRY_MAX_MS = 2_000;
const MS_PER_SECOND = 1_000;

export interface TranscriptConfidence {
  /** Mean segment avg_logprob, compared against TRANSCRIPT_MIN_AVG_LOGPROB. */
  meanAvgLogprob: number;
  worstAvgLogprob: number;
  maxNoSpeechProb: number;
  segmentCount: number;
}

export interface TranscriptionResult {
  transcript: string;
  words: Word[];
  /** Mean segment avg_logprob, compared against TRANSCRIPT_MIN_AVG_LOGPROB. */
  meanAvgLogprob: number;
  confidence: TranscriptConfidence;
  durationSec: number;
}

export type TranscriptionErrorCode = 'NO_SPEECH' | 'MISSING_TIMESTAMPS' | 'TRANSCRIPT_UNRELIABLE';

const TRANSCRIPTION_MESSAGES: Readonly<Record<TranscriptionErrorCode, string>> = {
  NO_SPEECH: 'We did not catch any speech. Try again.',
  MISSING_TIMESTAMPS: 'The transcript came back without timings, so it cannot be scored. Record again.',
  TRANSCRIPT_UNRELIABLE: 'That take was hard to make out, so it was not scored. Record it again somewhere quieter.',
};

/** A take that must be re-recorded (422). Extends HttpError so the central handler maps it directly. */
export class TranscriptionError extends HttpError {
  declare readonly code: TranscriptionErrorCode;

  constructor(code: TranscriptionErrorCode) {
    super(422, code, TRANSCRIPTION_MESSAGES[code]);
    this.name = 'TranscriptionError';
  }
}

/** Groq unreachable or failing after one retry (503). `upstreamStatus` is for logs only. */
export class UpstreamError extends HttpError {
  readonly upstreamStatus: number | undefined;

  constructor(service: 'transcription' | 'speech', upstreamStatus: number | undefined) {
    const what = service === 'transcription' ? 'Transcription' : 'Speech';
    super(503, 'UPSTREAM_UNAVAILABLE', `${what} is unavailable right now. Try again in a moment.`);
    this.name = 'UpstreamError';
    this.upstreamStatus = upstreamStatus;
  }
}

/** The slice of the Groq client this module uses; tests pass a fake. */
export interface GroqAudioClient {
  audio: {
    transcriptions: { create(params: Record<string, unknown>): Promise<unknown> };
    speech: { create(params: Record<string, unknown>): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> };
  };
}

export interface GroqServiceDeps {
  client: GroqAudioClient;
  /** null disables the disk layer (tests). */
  ttsCacheDir?: string | null;
  ttsCacheMaxEntries?: number;
  ttsDiskCacheMaxFiles?: number;
  /** Delay used before retrying a 429; tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GroqService {
  transcribe(audio: Buffer, mimeType: string): Promise<TranscriptionResult>;
  synthesizeSpeech(text: string): Promise<Buffer>;
}

// Whisper verbose_json, validated: external data is never trusted.
const wordSchema = z.object({ word: z.string(), start: z.number().finite(), end: z.number().finite() });
const segmentSchema = z.object({
  avg_logprob: z.number().finite(),
  no_speech_prob: z.number().finite().optional(),
});
const verboseSchema = z.object({
  text: z.string().default(''),
  duration: z.number().finite().optional(),
  words: z.array(z.unknown()).optional(),
  segments: z.array(z.unknown()).optional(),
});

/** Key for the TTS cache and the route's ETag: sha256(model + voice + text). */
export function ttsCacheKey(text: string): string {
  return createHash('sha256').update(`${GROQ_MODELS.tts}\n${TTS_VOICE}\n${text}`).digest('hex');
}

/** File extension Groq uses to sniff the container. */
export function extensionForMime(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.includes('webm')) return 'webm';
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) return 'm4a';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('wav')) return 'wav';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  if (base.includes('flac')) return 'flac';
  return 'webm';
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

/** 429, 5xx, and connection failures (no status) are worth one retry; 4xx are not. */
function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR_MIN;
}

function readRetryAfter(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return null;
  const { headers } = error;
  if (headers instanceof Headers) return headers.get('retry-after');
  if (typeof headers === 'object' && headers !== null && 'retry-after' in headers) {
    const value: unknown = headers['retry-after'];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/** Milliseconds to wait before the single retry: only a 429 waits, honouring retry-after within bounds. */
export function retryDelayMs(error: unknown): number {
  if (statusOf(error) !== HTTP_TOO_MANY_REQUESTS) return 0;
  const seconds = Number(readRetryAfter(error));
  const wanted = Number.isFinite(seconds) && seconds > 0 ? seconds * MS_PER_SECOND : RATE_LIMIT_RETRY_DEFAULT_MS;
  return Math.min(RATE_LIMIT_RETRY_MAX_MS, Math.max(RATE_LIMIT_RETRY_MIN_MS, wanted));
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withOneRetry<T>(
  service: 'transcription' | 'speech',
  call: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  try {
    return await call();
  } catch (first) {
    if (!isRetryable(first)) throw new UpstreamError(service, statusOf(first));
    const delay = retryDelayMs(first);
    if (delay > 0) await sleep(delay);
    try {
      return await call();
    } catch (second) {
      throw new UpstreamError(service, statusOf(second));
    }
  }
}

/**
 * Validate a verbose_json response into a scorable transcript, or throw TranscriptionError.
 * Order: no speech, then missing timestamps (fail loudly, never estimate), then confidence.
 */
export function parseTranscription(raw: unknown): TranscriptionResult {
  const parsed = verboseSchema.safeParse(raw);
  if (!parsed.success) throw new TranscriptionError('MISSING_TIMESTAMPS');
  const { text, duration, words: rawWords, segments: rawSegments } = parsed.data;
  const transcript = text.trim();

  if ((rawWords === undefined || rawWords.length === 0) && transcript === '') {
    throw new TranscriptionError('NO_SPEECH');
  }
  if (rawWords === undefined || rawWords.length === 0) throw new TranscriptionError('MISSING_TIMESTAMPS');

  const words: Word[] = [];
  for (const candidate of rawWords) {
    const word = wordSchema.safeParse(candidate);
    if (!word.success || word.data.end < word.data.start) throw new TranscriptionError('MISSING_TIMESTAMPS');
    words.push({ word: word.data.word, start: word.data.start, end: word.data.end });
  }

  const segments = (rawSegments ?? []).flatMap((s) => {
    const seg = segmentSchema.safeParse(s);
    return seg.success ? [seg.data] : [];
  });
  // No confidence signal means no way to trust the take: treat as unreliable rather than guess.
  if (segments.length === 0) throw new TranscriptionError('TRANSCRIPT_UNRELIABLE');
  const logprobs = segments.map((s) => s.avg_logprob);
  const meanAvgLogprob = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
  if (meanAvgLogprob < TRANSCRIPT_MIN_AVG_LOGPROB) throw new TranscriptionError('TRANSCRIPT_UNRELIABLE');

  const lastEnd = words[words.length - 1]?.end ?? 0;
  return {
    transcript,
    words,
    meanAvgLogprob,
    confidence: {
      meanAvgLogprob,
      worstAvgLogprob: Math.min(...logprobs),
      maxNoSpeechProb: Math.max(...segments.map((s) => s.no_speech_prob ?? 0)),
      segmentCount: segments.length,
    },
    durationSec: duration ?? lastEnd,
  };
}

/** Bounded LRU over a Map (insertion order = recency). */
class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

async function readDiskCache(dir: string | null, key: string): Promise<Buffer | undefined> {
  if (dir === null) return undefined;
  try {
    return await readFile(path.join(dir, `${key}.wav`));
  } catch {
    return undefined; // a cache miss, not an error
  }
}

/** Delete the oldest cached files once the directory holds more than maxFiles. */
async function pruneDiskCache(dir: string, maxFiles: number): Promise<void> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.wav'));
  if (names.length <= maxFiles) return;
  const files = await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      return { file, mtimeMs: info?.mtimeMs ?? 0 };
    }),
  );
  const oldestFirst = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  await Promise.all(oldestFirst.slice(0, files.length - maxFiles).map(({ file }) => unlink(file).catch(() => undefined)));
}

async function writeDiskCache(dir: string | null, key: string, audio: Buffer, maxFiles: number): Promise<void> {
  if (dir === null) return;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${key}.wav`), audio);
    await pruneDiskCache(dir, maxFiles);
  } catch (error) {
    // The memory layer still serves this line; a disk failure only costs a future re-bill.
    console.warn(`[groq] tts disk cache write failed: ${error instanceof Error ? error.name : 'unknown'}`);
  }
}

export function createGroqService(deps: GroqServiceDeps): GroqService {
  const { client } = deps;
  const cacheDir = deps.ttsCacheDir === undefined ? DEFAULT_TTS_CACHE_DIR : deps.ttsCacheDir;
  const memory = new LruCache<Buffer>(deps.ttsCacheMaxEntries ?? TTS_CACHE_MAX_ENTRIES);
  const diskMaxFiles = deps.ttsDiskCacheMaxFiles ?? TTS_DISK_CACHE_MAX_FILES;
  const inFlight = new Map<string, Promise<Buffer>>();
  const sleep = deps.sleep ?? realSleep;

  async function transcribe(audio: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const raw = await withOneRetry('transcription', async () => {
      const file = await toFile(audio, `answer.${extensionForMime(mimeType)}`, { type: mimeType });
      // No prompt: Phase 0 measured the verbatim prompt as unnecessary and slightly harmful.
      return client.audio.transcriptions.create({
        file,
        model: GROQ_MODELS.stt,
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        language: 'en',
      });
    }, sleep);
    return parseTranscription(raw);
  }

  async function fetchSpeech(text: string): Promise<Buffer> {
    return withOneRetry('speech', async () => {
      const response = await client.audio.speech.create({
        model: GROQ_MODELS.tts,
        voice: TTS_VOICE,
        input: text,
        response_format: 'wav',
      });
      return Buffer.from(await response.arrayBuffer());
    }, sleep);
  }

  async function synthesizeSpeech(text: string): Promise<Buffer> {
    const key = ttsCacheKey(text);
    const cached = memory.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const work = (async () => {
      const fromDisk = await readDiskCache(cacheDir, key);
      if (fromDisk) {
        memory.set(key, fromDisk);
        return fromDisk;
      }
      const audio = await fetchSpeech(text);
      memory.set(key, audio);
      await writeDiskCache(cacheDir, key, audio, diskMaxFiles);
      return audio;
    })();
    inFlight.set(key, work);
    try {
      return await work;
    } finally {
      inFlight.delete(key);
    }
  }

  return { transcribe, synthesizeSpeech };
}

let defaultService: GroqService | null = null;

function service(): GroqService {
  if (defaultService === null) {
    // Retries are handled here (one, on 429/5xx), not by the SDK.
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: GROQ_TIMEOUT_MS });
    // The SDK's create() overloads are stricter than the structural slice above (which exists for
    // test fakes); the params passed are exactly what the SDK documents, so the cast is safe.
    defaultService = createGroqService({ client: client as unknown as GroqAudioClient });
  }
  return defaultService;
}

/**
 * Transcribe one take with word + segment timestamps, no prompt.
 * Throws TranscriptionError (422: NO_SPEECH | MISSING_TIMESTAMPS | TRANSCRIPT_UNRELIABLE)
 * or UpstreamError (503) after one retry on 429/5xx.
 */
export async function transcribe(audio: Buffer, mimeType: string): Promise<TranscriptionResult> {
  return service().transcribe(audio, mimeType);
}

/** Synthesize a line to WAV bytes. Cached (memory LRU + disk) by ttsCacheKey(text). Throws UpstreamError. */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  return service().synthesizeSpeech(text);
}
