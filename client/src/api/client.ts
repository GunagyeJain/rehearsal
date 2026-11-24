import { API_BASE, API_ERROR_CODES, type ApiErrorBody, type ApiErrorCode } from '@rehearsal/shared';

/** Codes the client produces itself, when no well-formed error body came back. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'ABORTED';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly fields: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

type UnauthenticatedListener = () => void;
let unauthenticatedListener: UnauthenticatedListener | null = null;

/**
 * Called when an authenticated request comes back 401 (session expired or account deleted), so the
 * auth state can drop to signed out. The auth endpoints themselves never trigger it.
 */
export function setUnauthenticatedListener(listener: UnauthenticatedListener | null): void {
  unauthenticatedListener = listener;
}

function notifyIfUnauthenticated(path: string, code: ApiErrorCode | undefined): void {
  if (code === 'UNAUTHENTICATED' && !path.startsWith('/auth/')) unauthenticatedListener?.();
}

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and retry.';
const INVALID_MESSAGE = 'The server sent a response this app could not read. Retry in a moment.';

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string')
  );
}

/** Narrows an unknown JSON body to ApiErrorBody without trusting its shape. */
export function parseErrorBody(body: unknown): ApiErrorBody['error'] | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, fields } = error as Record<string, unknown>;
  if (!isApiErrorCode(code) || typeof message !== 'string') return null;
  return { code, message, fields: isStringRecord(fields) ? fields : undefined };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialised unless it is FormData, which is sent as multipart. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', INVALID_MESSAGE);
  }
}

/**
 * Typed fetch against the API. Sends the session cookie, returns the bare success body,
 * and throws ApiError for every failure, network included.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {} } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const init: RequestInit = {
    method,
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'ABORTED', 'The request was cancelled.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    // Trusting the server contract here: DTO types come from @rehearsal/shared.
    return (await readJson(response)) as T;
  }

  const parsed = parseErrorBody(await readJson(response).catch(() => undefined));
  notifyIfUnauthenticated(path, parsed?.code);
  if (parsed) throw new ApiError(response.status, parsed.code, parsed.message, parsed.fields);
  throw new ApiError(response.status, response.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', INVALID_MESSAGE);
}

/** Fetches a binary response (audio) with the same error handling. */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { method = 'GET', body, signal } = options;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }
  if (response.ok) return response.blob();
  const parsed = parseErrorBody(await readJson(response).catch(() => undefined));
  notifyIfUnauthenticated(path, parsed?.code);
  if (parsed) throw new ApiError(response.status, parsed.code, parsed.message, parsed.fields);
  throw new ApiError(response.status, 'INTERNAL', INVALID_MESSAGE);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => apiRequest<T>(path, { method: 'POST', body, signal }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
} as const;
