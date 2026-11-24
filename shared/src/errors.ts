/**
 * Thrown when a word array cannot be scored. spec/scoring.md: no estimation —
 * if timestamps are missing, fail loudly rather than guessing.
 */
export type ScoringErrorCode =
  | 'NO_WORDS'
  | 'MISSING_TIMESTAMPS'
  | 'INVALID_TIMESTAMPS'
  | 'EMPTY_CRITERIA'
  | 'UNKNOWN_METRIC';

export class ScoringInputError extends Error {
  readonly code: ScoringErrorCode;

  constructor(code: ScoringErrorCode, message: string) {
    super(message);
    this.name = 'ScoringInputError';
    this.code = code;
  }
}

export function isScoringInputError(value: unknown): value is ScoringInputError {
  return value instanceof ScoringInputError;
}
