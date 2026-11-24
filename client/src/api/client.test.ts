import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, parseErrorBody } from './client';

function mockFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('sends credentials and JSON, and returns the bare body', async () => {
    const fetchMock = mockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const body = await apiRequest<{ ok: boolean }>('/health', { method: 'POST', body: { a: 1 } });

    expect(body).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/health');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"a":1}');
  });

  it('throws a typed ApiError from an error body', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ error: { code: 'EMAIL_TAKEN', message: 'That email already has an account.' } }), {
          status: 409,
        }),
    );

    const error = await apiRequest('/auth/signup').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('EMAIL_TAKEN');
    expect((error as ApiError).status).toBe(409);
  });

  it('maps a network failure to NETWORK_ERROR', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await apiRequest('/path').catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
  });

  it('rejects malformed error bodies', () => {
    expect(parseErrorBody({ error: { code: 'NOPE', message: 'x' } })).toBeNull();
    expect(parseErrorBody('text')).toBeNull();
  });
});
