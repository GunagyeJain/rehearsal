import { Schema, model, type Types } from 'mongoose';
import {
  DEFAULT_SETTINGS,
  type BaselineFeedback,
  type BaselineMetrics,
  type UserProfile,
  type UserSettings,
} from '@rehearsal/shared';

export interface BaselineRecord {
  recordingId: Types.ObjectId | null;
  transcript: string;
  metrics: BaselineMetrics;
  feedback: BaselineFeedback;
  recordedAt: Date;
}

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
  profile: UserProfile | null;
  settings: UserSettings;
  baseline: BaselineRecord | null;
  /** Bumped on sign-out; a session token carrying an older value is rejected (spec/api.md). */
  sessionVersion: number;
  /** Set first by account deletion; background writers drop their work for such a user. */
  deleting: boolean;
}

const MIN_CONFIDENCE = 1;
const MAX_CONFIDENCE = 5;

const profileSchema = new Schema<UserProfile>(
  {
    goal: { type: String, required: true },
    goalDetail: { type: String, default: '' },
    timeframe: { type: String, required: true },
    field: { type: String, default: '' },
    confidence: { type: Number, required: true, min: MIN_CONFIDENCE, max: MAX_CONFIDENCE },
  },
  { _id: false },
);

const settingsSchema = new Schema<UserSettings>(
  {
    theme: { type: String, enum: ['light', 'dark', 'system'], default: DEFAULT_SETTINGS.theme },
    font: { type: String, enum: ['serif', 'sans', 'mono'], default: DEFAULT_SETTINGS.font },
    showTranscript: { type: Boolean, default: DEFAULT_SETTINGS.showTranscript },
  },
  { _id: false },
);

const baselineSchema = new Schema<BaselineRecord>(
  {
    recordingId: { type: Schema.Types.ObjectId, ref: 'Recording', default: null },
    transcript: { type: String, default: '' },
    metrics: { type: Schema.Types.Mixed, required: true },
    feedback: {
      strength: { type: String, default: '' },
      observation: { type: String, default: '' },
    },
    recordedAt: { type: Date, required: true },
  },
  { _id: false },
);

const userSchema = new Schema<UserDoc>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
  profile: { type: profileSchema, default: null },
  settings: { type: settingsSchema, default: () => ({ ...DEFAULT_SETTINGS }) },
  baseline: { type: baselineSchema, default: null },
  sessionVersion: { type: Number, default: 0, min: 0 },
  deleting: { type: Boolean, default: false },
});

export const UserModel = model<UserDoc>('User', userSchema);
