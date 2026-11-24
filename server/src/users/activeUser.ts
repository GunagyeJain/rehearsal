import type { Types } from 'mongoose';
import { HttpError } from '../http/HttpError';
import { UserModel } from '../models/User';

/**
 * True while the user exists and is not being deleted. Writers that can finish after an account
 * deletion started (judge, uploads) check this after writing and undo their write when false.
 */
export async function isUserActive(userId: Types.ObjectId): Promise<boolean> {
  return (await UserModel.exists({ _id: userId, deleting: { $ne: true } })) !== null;
}

/** The error a writer throws after undoing a write for an account deleted meanwhile. */
export function accountGoneError(): HttpError {
  return new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
}
