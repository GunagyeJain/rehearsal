import type {
  AttemptDetailResponse,
  FinalizeAttemptResponse,
  GenerateTurnResponse,
  ScenarioDetailResponse,
  SkipResponse,
  StartAttemptRequest,
  StartAttemptResponse,
  TtsRequest,
  UploadAnswerResponse,
  UserInputValues,
} from '@rehearsal/shared';
import { api, apiBlob } from '../../api/client';

/** Typed calls for the scenario flow. Paths and shapes follow spec/api.md. */

export function getScenario(id: string, signal?: AbortSignal): Promise<ScenarioDetailResponse> {
  return api.get<ScenarioDetailResponse>(`/scenarios/${encodeURIComponent(id)}`, signal);
}

export function startAttempt(scenarioId: string, userInputs: UserInputValues): Promise<StartAttemptResponse> {
  const body: StartAttemptRequest = { scenarioId, userInputs: { ...userInputs } };
  return api.post<StartAttemptResponse>('/attempts', body);
}

export function generateTurn(attemptId: string, turnIndex: number): Promise<GenerateTurnResponse> {
  return api.post<GenerateTurnResponse>(`/attempts/${attemptId}/turns/${turnIndex}/generate`);
}

/** Audio for a stored attempt line or a fixed prompt; the server never speaks arbitrary text. */
export async function fetchTts(body: TtsRequest): Promise<ArrayBuffer> {
  const blob = await apiBlob('/tts', { method: 'POST', body });
  return blob.arrayBuffer();
}

export function uploadAnswer(
  attemptId: string,
  turnIndex: number,
  recording: { blob: Blob; mimeType: string; durationSec: number },
): Promise<UploadAnswerResponse> {
  const form = new FormData();
  const extension = recording.mimeType.includes('mp4') ? 'm4a' : 'webm';
  form.append('audio', recording.blob, `turn-${turnIndex}.${extension}`);
  form.append('durationSec', recording.durationSec.toFixed(2));
  return api.post<UploadAnswerResponse>(`/attempts/${attemptId}/turns/${turnIndex}/answer`, form);
}

export function finalizeAttempt(attemptId: string): Promise<FinalizeAttemptResponse> {
  return api.post<FinalizeAttemptResponse>(`/attempts/${attemptId}/finalize`);
}

export function getAttempt(attemptId: string, signal?: AbortSignal): Promise<AttemptDetailResponse> {
  return api.get<AttemptDetailResponse>(`/attempts/${encodeURIComponent(attemptId)}`, signal);
}

export function fetchRecording(audioId: string, signal?: AbortSignal): Promise<Blob> {
  return apiBlob(`/recordings/${encodeURIComponent(audioId)}/audio`, { signal });
}

/** POST /api/path/:scenarioId/skip: allowed from the third attempt on a path item that is not yet passed. */
export function skipPathItem(scenarioId: string): Promise<SkipResponse> {
  return api.post<SkipResponse>(`/path/${encodeURIComponent(scenarioId)}/skip`);
}
