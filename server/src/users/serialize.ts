import type { User } from '@rehearsal/shared';
import type { Types } from 'mongoose';
import { PathModel } from '../models/Path';
import { UserModel, type UserDoc } from '../models/User';
import { notFound } from '../http/HttpError';

type UserFields = Pick<UserDoc, '_id' | 'email' | 'createdAt' | 'profile' | 'settings'>;

/** The public User DTO. Never includes the password hash or baseline audio references. */
export function toUserDto(doc: UserFields, onboarded: boolean): User {
  return {
    id: doc._id.toHexString(),
    email: doc.email,
    createdAt: doc.createdAt.toISOString(),
    profile: doc.profile
      ? {
          goal: doc.profile.goal,
          goalDetail: doc.profile.goalDetail,
          timeframe: doc.profile.timeframe,
          field: doc.profile.field,
          confidence: doc.profile.confidence,
        }
      : null,
    settings: { theme: doc.settings.theme, font: doc.settings.font, showTranscript: doc.settings.showTranscript },
    onboarded,
  };
}

/** spec/api.md: `onboarded` is true once a path exists. */
export async function isOnboarded(userId: Types.ObjectId): Promise<boolean> {
  return (await PathModel.exists({ userId })) !== null;
}

/** Load the signed-in user's DTO. A missing user (deleted mid-session) is a 404. */
export async function loadUserDto(userId: Types.ObjectId): Promise<User> {
  const doc = await UserModel.findOne({ _id: userId })
    .select('email createdAt profile settings')
    .lean<UserFields>();
  if (!doc) throw notFound('Account not found.');
  return toUserDto(doc, await isOnboarded(userId));
}
