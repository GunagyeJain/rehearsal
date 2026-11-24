import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { isScoringInputError, type ApiErrorBody, type ApiErrorCode } from '@rehearsal/shared';
import { HttpError } from '../http/HttpError';
import { safeErrorLabel } from '../http/safeErrorLabel';

interface Mapped {
  status: number;
  code: ApiErrorCode;
  message: string;
  fields?: Record<string, string>;
}

const GENERIC_MESSAGE = 'Something went wrong on our side. Please try again.';

/** Error thrown by express.json / body-parser carries a `type` and `status`. */
function bodyParserType(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string') return err.type;
  return undefined;
}

export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

function mapError(err: unknown): Mapped {
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message, ...(err.fields ? { fields: { ...err.fields } } : {}) };
  }
  if (err instanceof z.ZodError) {
    return { status: 400, code: 'VALIDATION_FAILED', message: 'Some fields are invalid.', fields: zodFields(err) };
  }
  if (isScoringInputError(err)) {
    if (err.code === 'NO_WORDS') return { status: 422, code: 'NO_SPEECH', message: 'We did not catch any speech. Try again.' };
    if (err.code === 'MISSING_TIMESTAMPS' || err.code === 'INVALID_TIMESTAMPS') {
      return { status: 422, code: 'MISSING_TIMESTAMPS', message: 'The transcript came back without timings, so it cannot be scored. Record again.' };
    }
  }
  const type = bodyParserType(err);
  if (type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' };
  if (type === 'entity.parse.failed') return { status: 400, code: 'BAD_REQUEST', message: 'The request body is not valid JSON.' };
  if (type !== undefined) return { status: 400, code: 'BAD_REQUEST', message: 'The request could not be read.' };
  return { status: 500, code: 'INTERNAL', message: GENERIC_MESSAGE };
}

/** 404 for unknown /api routes. */
export const apiNotFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'No such endpoint.'));
};

/**
 * Central error handler. Logs method, path, code and (for 5xx) the error class and status;
 * never the request body, audio, or transcripts.
 */
export function createErrorHandler(_opts: { production: boolean }): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const mapped = mapError(err);
    if (mapped.status >= 500) {
      // Name and status/code only: messages and stacks can embed transcript or word data.
      console.error(`[http] ${req.method} ${req.path} -> ${mapped.status} ${mapped.code}: ${safeErrorLabel(err)}`);
    }
    const body: ApiErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.fields ? { fields: mapped.fields } : {}),
      },
    };
    res.status(mapped.status).json(body);
  };
}
