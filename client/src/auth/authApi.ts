import type {
  AuthUserResponse,
  CredentialsRequest,
  SettingsPatchRequest,
  SettingsResponse,
} from '@rehearsal/shared';
import { api } from '../api/client';

export function fetchMe(signal?: AbortSignal): Promise<AuthUserResponse> {
  return api.get<AuthUserResponse>('/auth/me', signal);
}

export function signInRequest(body: CredentialsRequest): Promise<AuthUserResponse> {
  return api.post<AuthUserResponse>('/auth/signin', body);
}

export function signUpRequest(body: CredentialsRequest): Promise<AuthUserResponse> {
  return api.post<AuthUserResponse>('/auth/signup', body);
}

export function signOutRequest(): Promise<void> {
  return api.post<void>('/auth/signout');
}

export function patchSettings(body: SettingsPatchRequest): Promise<SettingsResponse> {
  return api.patch<SettingsResponse>('/users/me/settings', body);
}
