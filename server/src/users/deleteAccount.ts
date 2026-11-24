import type { Types } from 'mongoose';
import { AttemptModel } from '../models/Attempt';
import { PathModel } from '../models/Path';
import { ProgressModel } from '../models/Progress';
import { UserModel } from '../models/User';
import { purgeUserRecordings } from '../storage/recordings';

/**
 * Remove everything the user owns (spec/api.md DELETE /api/account). The user is marked `deleting`
 * first, so a judge or upload still in flight undoes its own write (see isUserActive); then
 * recordings (blobs and documents), attempts, progress and path, and the user last.
 */
export async function deleteUserAccount(userId: Types.ObjectId): Promise<void> {
  await UserModel.updateOne({ _id: userId }, { $set: { deleting: true } });
  await purgeUserRecordings(userId);
  await Promise.all([
    AttemptModel.deleteMany({ userId }),
    ProgressModel.deleteMany({ userId }),
    PathModel.deleteMany({ userId }),
  ]);
  await UserModel.deleteOne({ _id: userId });
}
