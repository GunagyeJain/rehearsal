import { Router, type RequestHandler } from 'express';
import {
  profileInputSchema,
  profilePatchSchema,
  settingsPatchSchema,
  type MeResponse,
  type ProfileResponse,
  type SettingsResponse,
  type UserProfile,
  type UserSettings,
} from '@rehearsal/shared';
import { HttpError, notFound } from '../http/HttpError';
import { parseBody } from '../middleware/validate';
import { userIdOf } from '../middleware/requireUser';
import { UserModel, type UserDoc } from '../models/User';
import { loadUserDto } from '../users/serialize';
import { zodFields } from '../middleware/errorHandler';

export interface UsersRouterDeps {
  requireUser: RequestHandler;
}

function prefixed(patch: Readonly<Record<string, unknown>>, prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [`${prefix}.${key}`, value]));
}

/** /api/users/me*: the signed-in user's own document only. */
export function createUsersRouter(deps: UsersRouterDeps): Router {
  const router = Router();

  router.get('/users/me', deps.requireUser, async (req, res) => {
    const body: MeResponse = { user: await loadUserDto(userIdOf(req)) };
    res.json(body);
  });

  router.patch('/users/me/settings', deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const patch = parseBody(settingsPatchSchema, req.body);
    const updated = await UserModel.findOneAndUpdate(
      { _id: userId },
      { $set: prefixed(patch, 'settings') },
      { returnDocument: 'after', runValidators: true },
    )
      .select('settings')
      .lean<Pick<UserDoc, 'settings'>>();
    if (!updated) throw notFound('Account not found.');
    const settings: UserSettings = {
      theme: updated.settings.theme,
      font: updated.settings.font,
      showTranscript: updated.settings.showTranscript,
    };
    const body: SettingsResponse = { settings };
    res.json(body);
  });

  router.patch('/users/me/profile', deps.requireUser, async (req, res) => {
    const userId = userIdOf(req);
    const patch = parseBody(profilePatchSchema, req.body);
    const current = await UserModel.findOne({ _id: userId }).select('profile').lean<Pick<UserDoc, 'profile'>>();
    if (!current) throw notFound('Account not found.');
    if (!current.profile) throw new HttpError(409, 'PROFILE_REQUIRED', 'Finish onboarding before editing your profile.');
    // Re-validate the merged profile so cross-field rules (goal 'other' needs detail) still hold.
    const merged = profileInputSchema.safeParse({ ...current.profile, ...patch });
    if (!merged.success) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', zodFields(merged.error));
    }
    const profile: UserProfile = { ...merged.data };
    await UserModel.updateOne({ _id: userId }, { $set: { profile } });
    const body: ProfileResponse = { profile };
    res.json(body);
  });

  return router;
}
