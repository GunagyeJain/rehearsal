import { Schema, model, type Types } from 'mongoose';
import type { AttemptStatus, Metrics, ProvisionalReport, UserInputValues, Verdict, Word } from '@rehearsal/shared';

export interface AttemptTurnDoc {
  index: number;
  aiText: string;
  audioId: Types.ObjectId | null;
  transcript: string;
  words: Word[];
  audioDurationSec?: number;
}

export interface AttemptDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  scenarioId: string;
  userInputs: UserInputValues;
  status: AttemptStatus;
  startedAt: Date;
  completedAt: Date | null;
  turns: AttemptTurnDoc[];
  metrics: Metrics | null;
  verdict: Verdict | null;
  /** First-pass report, kept while status is 'scoring'. */
  provisional: ProvisionalReport | null;
  /** When the background judge last started; used to re-judge after a restart. */
  scoringStartedAt: Date | null;
}

export const ATTEMPT_STATUSES: readonly AttemptStatus[] = ['in_progress', 'scoring', 'scored', 'abandoned'];

const wordSchema = new Schema<Word>(
  {
    word: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
  },
  { _id: false },
);

const turnSchema = new Schema<AttemptTurnDoc>(
  {
    index: { type: Number, required: true, min: 0 },
    aiText: { type: String, required: true },
    audioId: { type: Schema.Types.ObjectId, ref: 'Recording', default: null },
    transcript: { type: String, default: '' },
    words: { type: [wordSchema], default: [] },
    audioDurationSec: { type: Number },
  },
  { _id: false },
);

const verdictSchema = new Schema<Verdict>(
  {
    criteria: { type: Schema.Types.Mixed, default: () => [] },
    passedCount: { type: Number, required: true },
    totalCount: { type: Number, required: true },
    passed: { type: Boolean, required: true },
    evidence: { type: String, default: '' },
    nextAction: { type: String, default: '' },
    judgeUnavailable: { type: Boolean, default: false },
  },
  { _id: false },
);

const attemptSchema = new Schema<AttemptDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scenarioId: { type: String, required: true },
    userInputs: { type: Schema.Types.Mixed, default: () => ({}) },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'in_progress' },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    turns: { type: [turnSchema], default: [] },
    metrics: { type: Schema.Types.Mixed, default: null },
    verdict: { type: verdictSchema, default: null },
    provisional: { type: Schema.Types.Mixed, default: null },
    scoringStartedAt: { type: Date, default: null },
  },
  { minimize: false },
);

attemptSchema.index({ userId: 1, scenarioId: 1, startedAt: -1 });

export const AttemptModel = model<AttemptDoc>('Attempt', attemptSchema);
