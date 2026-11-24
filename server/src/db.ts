import mongoose from 'mongoose';

export type DbStatus = 'up' | 'down';

export interface ConnectOptions {
  /** Total attempts before giving up. */
  maxAttempts?: number;
  /** First retry delay; doubles each attempt up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  serverSelectionTimeoutMs?: number;
}

const DEFAULTS: Required<ConnectOptions> = {
  maxAttempts: 8,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  serverSelectionTimeoutMs: 5_000,
};

const RECORDINGS_BUCKET = 'recordings';
const READY_STATE_CONNECTED = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Redact credentials so a URI can be logged safely. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, '//***@');
}

/** Connect with exponential backoff. Throws after maxAttempts. */
export async function connectDb(uri: string, options: ConnectOptions = {}): Promise<typeof mongoose> {
  const opts = { ...DEFAULTS, ...options };
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    try {
      const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: opts.serverSelectionTimeoutMs });
      console.info(`[db] connected to ${redactMongoUri(uri)}`);
      return conn;
    } catch (error: unknown) {
      lastError = error;
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt === opts.maxAttempts) break;
      const delay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
      console.warn(`[db] connect attempt ${attempt}/${opts.maxAttempts} failed (${reason}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error(`[db] could not connect after ${opts.maxAttempts} attempts`, { cause: lastError });
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.info('[db] disconnected');
  }
}

export function dbStatus(): DbStatus {
  return mongoose.connection.readyState === READY_STATE_CONNECTED ? 'up' : 'down';
}

/** GridFS bucket for user recordings. Requires an open connection. */
export function getRecordingsBucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db || dbStatus() !== 'up') {
    throw new Error('[db] GridFS requested before the database connection is open');
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: RECORDINGS_BUCKET });
}
