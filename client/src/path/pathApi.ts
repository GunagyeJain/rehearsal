import type {
  AuthUserResponse,
  BaselineResponse,
  GeneratePathResponse,
  OnboardingProfileRequest,
  PathResponse,
} from '@rehearsal/shared';
import { api } from '../api/client';

/** Typed calls for onboarding and the path. Paths and shapes follow spec/api.md. */

export function getPath(signal?: AbortSignal): Promise<PathResponse> {
  return api.get<PathResponse>('/path', signal);
}

export function saveOnboardingProfile(profile: OnboardingProfileRequest): Promise<AuthUserResponse> {
  return api.put<AuthUserResponse>('/onboarding/profile', profile);
}

export function uploadBaseline(recording: { blob: Blob; mimeType: string; durationSec: number }): Promise<BaselineResponse> {
  const form = new FormData();
  const extension = recording.mimeType.includes('mp4') ? 'm4a' : 'webm';
  form.append('audio', recording.blob, `baseline.${extension}`);
  form.append('durationSec', recording.durationSec.toFixed(2));
  return api.post<BaselineResponse>('/onboarding/baseline', form);
}

/** Idempotent: returns the stored path when one exists. */
export function generatePath(): Promise<GeneratePathResponse> {
  return api.post<GeneratePathResponse>('/onboarding/path');
}
