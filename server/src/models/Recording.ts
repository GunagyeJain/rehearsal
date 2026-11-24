import { Schema, model, type Types } from 'mongoose';

export type RecordingKind = 'attempt' | 'baseline';

/** Metadata for a GridFS blob in bucket 'recordings'. The GridFS file id equals this document's _id. */
export interface RecordingDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: RecordingKind;
  attemptId: Types.ObjectId | null;
  turnIndex: number | null;
  mimeType: string;
  durationSec: number;
  sizeBytes: number;
  createdAt: Date;
}

const recordingSchema = new Schema<RecordingDoc>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['attempt', 'baseline'], required: true },
  attemptId: { type: Schema.Types.ObjectId, ref: 'Attempt', default: null },
  turnIndex: { type: Number, default: null },
  mimeType: { type: String, required: true },
  durationSec: { type: Number, required: true, min: 0 },
  sizeBytes: { type: Number, required: true, min: 0 },
  createdAt: { type: Date, default: () => new Date() },
});

export const RecordingModel = model<RecordingDoc>('Recording', recordingSchema);
