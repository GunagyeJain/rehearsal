/**
 * A log label for an unknown error that never carries its message or stack. Mongoose
 * validation, cast and duplicate-key messages embed the offending value, which can be
 * transcript text or word data (spec/data-model.md: never log transcripts or word arrays).
 * Only the error class plus a numeric status or code (Anthropic, Groq, Mongo) are kept.
 */
export function safeErrorLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'non-Error thrown';
  const parts = [error.name];
  const record = error as Error & { status?: unknown; upstreamStatus?: unknown; code?: unknown };
  if (typeof record.status === 'number') parts.push(`status ${record.status}`);
  if (typeof record.upstreamStatus === 'number') parts.push(`upstream ${record.upstreamStatus}`);
  if (typeof record.code === 'number' || (typeof record.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(record.code))) {
    parts.push(`code ${record.code}`);
  }
  return parts.join(' ');
}
