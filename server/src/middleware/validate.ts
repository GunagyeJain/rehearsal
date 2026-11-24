import type { z } from 'zod';
import { HttpError } from '../http/HttpError';
import { zodFields } from './errorHandler';

/** Parse a request body with a shared zod schema; throws 400 VALIDATION_FAILED with fields. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', zodFields(result.error));
  }
  return result.data;
}
