import { Schema, model, type Types } from 'mongoose';

export interface PathDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  scenarioIds: string[];
  generatedAt: Date;
  completedAt: Date | null;
}

/** One per user (spec/data-model.md), so userId is unique. */
const pathSchema = new Schema<PathDoc>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  scenarioIds: { type: [String], default: [] },
  generatedAt: { type: Date, default: () => new Date() },
  completedAt: { type: Date, default: null },
});

export const PathModel = model<PathDoc>('Path', pathSchema);
