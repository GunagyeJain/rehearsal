import type { Types } from 'mongoose';
import type { RecordingListResponse, RecordingSummary } from '@rehearsal/shared';
import { AttemptModel } from '../models/Attempt';
import { RecordingModel, type RecordingDoc } from '../models/Recording';
import { UserModel } from '../models/User';
import { deleteUserRecording, purgeUserRecordings } from './recordings';

/**
 * Recording management for Settings (spec/data-model.md privacy rules). Every query is scoped by
 * userId. Deleting a recording nulls the references to it but keeps transcripts and metrics, so
 * history survives.
 */

type TitleLookup = (scenarioId: string) => string | undefined;

/** The user's recordings, newest first, with the scenario resolved for attempt recordings. */
export async function listUserRecordings(userId: Types.ObjectId, titleOf: TitleLookup): Promise<RecordingListResponse> {
  const docs = await RecordingModel.find({ userId }).sort({ createdAt: -1, _id: -1 }).lean<RecordingDoc[]>();
  const attemptIds = docs.flatMap((d) => (d.attemptId ? [d.attemptId] : []));
  const attempts = attemptIds.length
    ? await AttemptModel.find({ _id: { $in: attemptIds }, userId }).select({ scenarioId: 1 }).lean<{ _id: Types.ObjectId; scenarioId: string }[]>()
    : [];
  const scenarioByAttempt = new Map(attempts.map((a) => [a._id.toHexString(), a.scenarioId]));

  const recordings: RecordingSummary[] = docs.map((d) => {
    const scenarioId = d.attemptId ? (scenarioByAttempt.get(d.attemptId.toHexString()) ?? null) : null;
    return {
      id: d._id.toHexString(),
      kind: d.kind,
      attemptId: d.attemptId ? d.attemptId.toHexString() : null,
      scenarioId,
      scenarioTitle: scenarioId ? (titleOf(scenarioId) ?? null) : null,
      turnIndex: d.turnIndex,
      mimeType: d.mimeType,
      durationSec: d.durationSec,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt.toISOString(),
    };
  });
  return {
    count: recordings.length,
    totalBytes: recordings.reduce((sum, r) => sum + r.sizeBytes, 0),
    recordings,
  };
}

/** Null every reference to one recording: the attempt turn's audioId and the baseline's recordingId. */
async function clearReferences(userId: Types.ObjectId, recordingId: Types.ObjectId): Promise<void> {
  await AttemptModel.updateMany(
    { userId, 'turns.audioId': recordingId },
    { $set: { 'turns.$[turn].audioId': null } },
    { arrayFilters: [{ 'turn.audioId': recordingId }] },
  );
  await UserModel.updateOne({ _id: userId, 'baseline.recordingId': recordingId }, { $set: { 'baseline.recordingId': null } });
}

/** Delete one of the user's recordings. Returns false when it does not exist for this user. */
export async function deleteRecordingAndReferences(userId: Types.ObjectId, recordingId: Types.ObjectId): Promise<boolean> {
  const deleted = await deleteUserRecording(userId, recordingId);
  if (!deleted) return false;
  await clearReferences(userId, recordingId);
  return true;
}

/** Delete every recording the user owns (orphaned blobs included) and null all references. */
export async function deleteAllRecordingsAndReferences(userId: Types.ObjectId): Promise<number> {
  const deletedCount = await purgeUserRecordings(userId);
  await AttemptModel.updateMany({ userId, 'turns.audioId': { $ne: null } }, { $set: { 'turns.$[turn].audioId': null } }, {
    arrayFilters: [{ 'turn.audioId': { $ne: null } }],
  });
  await UserModel.updateOne({ _id: userId, 'baseline.recordingId': { $ne: null } }, { $set: { 'baseline.recordingId': null } });
  return deletedCount;
}
