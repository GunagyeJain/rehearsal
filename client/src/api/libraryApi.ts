import type {
  AttemptHistoryResponse,
  DeleteAccountRequest,
  DeleteAllRecordingsResponse,
  RecordingListResponse,
  ScenarioListResponse,
} from '@rehearsal/shared';
import { api, apiBlob } from './client';

/** Typed calls for History, Explore and Settings (spec/api.md, Phase 8). */

export function getScenarioList(signal?: AbortSignal): Promise<ScenarioListResponse> {
  return api.get<ScenarioListResponse>('/scenarios', signal);
}

export function getAttemptHistory(signal?: AbortSignal): Promise<AttemptHistoryResponse> {
  return api.get<AttemptHistoryResponse>('/attempts', signal);
}

export function getRecordings(signal?: AbortSignal): Promise<RecordingListResponse> {
  return api.get<RecordingListResponse>('/recordings', signal);
}

export function fetchRecordingAudio(id: string, signal?: AbortSignal): Promise<Blob> {
  return apiBlob(`/recordings/${encodeURIComponent(id)}/audio`, { signal });
}

export function deleteRecording(id: string): Promise<void> {
  return api.delete<void>(`/recordings/${encodeURIComponent(id)}`);
}

export function deleteAllRecordings(): Promise<DeleteAllRecordingsResponse> {
  return api.delete<DeleteAllRecordingsResponse>('/account/recordings');
}

export function deleteAccount(body: DeleteAccountRequest): Promise<void> {
  return api.delete<void>('/account', body);
}
