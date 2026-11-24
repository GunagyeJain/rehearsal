import type { Readable } from 'node:stream';
import { Types } from 'mongoose';
import { getRecordingsBucket } from '../db';
import { RecordingModel, type RecordingDoc, type RecordingKind } from '../models/Recording';
import { HttpError } from '../http/HttpError';
import { isUserActive } from '../users/activeUser';

/**
 * GridFS storage for user recordings (bucket 'recordings').
 * Every lookup is scoped by userId; nothing here ever returns a recording by id alone.
 */

export interface PutRecordingInput {
  userId: Types.ObjectId;
  kind: RecordingKind;
  attemptId: Types.ObjectId | null;
  turnIndex: number | null;
  mimeType: string;
  durationSec: number;
  data: Buffer;
}

/** Inclusive byte range. */
export interface ByteRange {
  start: number;
  end: number;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && /FileNotFound|File not found/i.test(error.message);
}

function writeBlob(id: Types.ObjectId, input: PutRecordingInput): Promise<void> {
  const bucket = getRecordingsBucket();
  return new Promise((resolve, reject) => {
    const upload = bucket.openUploadStreamWithId(id, `${id.toHexString()}`, {
      metadata: {
        userId: input.userId,
        kind: input.kind,
        attemptId: input.attemptId,
        turnIndex: input.turnIndex,
        mimeType: input.mimeType,
        durationSec: input.durationSec,
        sizeBytes: input.data.length,
      },
    });
    upload.once('error', reject);
    upload.once('finish', () => resolve());
    upload.end(input.data);
  });
}

async function deleteBlob(id: Types.ObjectId): Promise<void> {
  try {
    await getRecordingsBucket().delete(id);
  } catch (error: unknown) {
    if (!isFileNotFound(error)) throw error;
  }
}

/** Store the blob, then its metadata document. Returns the shared id. */
export async function putRecording(input: PutRecordingInput): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await writeBlob(id, input);
  try {
    await RecordingModel.create({
      _id: id,
      userId: input.userId,
      kind: input.kind,
      attemptId: input.attemptId,
      turnIndex: input.turnIndex,
      mimeType: input.mimeType,
      durationSec: input.durationSec,
      sizeBytes: input.data.length,
    });
  } catch (error: unknown) {
    await deleteBlob(id).catch(() => undefined);
    throw error;
  }
  // The account may have been deleted while this upload ran: never leave audio behind for it.
  if (!(await isUserActive(input.userId))) {
    await RecordingModel.deleteOne({ _id: id, userId: input.userId });
    await deleteBlob(id).catch(() => undefined);
    throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  }
  return id;
}

/** The user's own recording metadata, or null (another user's id is indistinguishable from a missing one). */
export async function findUserRecording(userId: Types.ObjectId, id: Types.ObjectId): Promise<RecordingDoc | null> {
  return RecordingModel.findOne({ _id: id, userId }).lean<RecordingDoc>();
}

/** Open a download stream for a recording already checked with findUserRecording. */
export function openRecordingStream(recording: Pick<RecordingDoc, '_id'>, range?: ByteRange): Readable {
  const bucket = getRecordingsBucket();
  // GridFS `end` is exclusive.
  return range
    ? bucket.openDownloadStream(recording._id, { start: range.start, end: range.end + 1 })
    : bucket.openDownloadStream(recording._id);
}

/** Delete the user's recording blob and document. Returns false when it does not exist for this user. */
export async function deleteUserRecording(userId: Types.ObjectId, id: Types.ObjectId): Promise<boolean> {
  const recording = await RecordingModel.findOne({ _id: id, userId }).select('_id').lean();
  if (!recording) return false;
  await deleteBlob(id);
  await RecordingModel.deleteOne({ _id: id, userId });
  return true;
}

/**
 * Parse a single `bytes=` Range header against a file size.
 * null: no usable range (serve 200). 'unsatisfiable': respond 416.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (size === 0) return 'unsatisfiable';
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/**
 * Delete every recording blob and document the user owns, including blobs whose metadata document
 * was never written (an upload that failed half way). Used by account deletion. Returns the number
 * of recording documents removed.
 */
export async function purgeUserRecordings(userId: Types.ObjectId): Promise<number> {
  const bucket = getRecordingsBucket();
  const docIds = (await RecordingModel.find({ userId }).select('_id').lean()).map((r) => r._id);
  const orphanIds = (await bucket.find({ 'metadata.userId': userId }, { projection: { _id: 1 } }).toArray()).map(
    (f) => f._id,
  );
  const blobIds = new Map<string, Types.ObjectId>();
  for (const id of [...docIds, ...orphanIds]) blobIds.set(id.toHexString(), new Types.ObjectId(id.toHexString()));
  for (const id of blobIds.values()) await deleteBlob(id);
  const result = await RecordingModel.deleteMany({ userId });
  return result.deletedCount;
}
