import type { ApiErrorCode } from '@rehearsal/shared';

/** An error with a status and an API code. `message` must be safe to show the user. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, fields?: Readonly<Record<string, string>>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function notFound(message = 'Not found.'): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}
