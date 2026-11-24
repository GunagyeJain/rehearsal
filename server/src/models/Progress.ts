import { Schema, model, type Types } from 'mongoose';
import type { ProgressStatus } from '@rehearsal/shared';

export interface ProgressDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  scenarioId: string;
  status: ProgressStatus;
  attemptCount: number;
  bestAttemptId: Types.ObjectId | null;
  lastAttemptId: Types.ObjectId | null;
  unlockedAt: Date | null;
}

export const PROGRESS_STATUSES: readonly ProgressStatus[] = ['locked', 'available', 'failed', 'passed', 'skipped'];

const progressSchema = new Schema<ProgressDoc>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scenarioId: { type: String, required: true },
  status: { type: String, enum: PROGRESS_STATUSES, default: 'available' },
  attemptCount: { type: Number, default: 0, min: 0 },
  bestAttemptId: { type: Schema.Types.ObjectId, ref: 'Attempt', default: null },
  lastAttemptId: { type: Schema.Types.ObjectId, ref: 'Attempt', default: null },
  unlockedAt: { type: Date, default: null },
});

progressSchema.index({ userId: 1, scenarioId: 1 }, { unique: true });

export const ProgressModel = model<ProgressDoc>('Progress', progressSchema);
