/**
 * Filler vocabulary from spec/scoring.md.
 *
 * DEFINITE fillers always count. AMBIGUOUS words are only counted once the
 * judge has ruled each occurrence a filler (they are sent with context in the
 * same call as the judged criterion).
 */

/** Every filler in the spec list, as written there. */
export const FILLER_WORDS = [
  'um', 'uh', 'umm', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mmm',
  'like', 'you know', 'i mean', 'sort of', 'kind of',
  'basically', 'actually', 'so yeah', 'right',
] as const;

/** Words that need a ruling before they count. "so" is not in the filler list but is ambiguous. */
export const AMBIGUOUS_FILLERS = ['like', 'actually', 'basically', 'right', 'so'] as const;

const ambiguousSet: ReadonlySet<string> = new Set(AMBIGUOUS_FILLERS);

/** Fillers that always count: the spec list minus the ambiguous words. */
export const DEFINITE_FILLERS: readonly string[] = FILLER_WORDS.filter((f) => !ambiguousSet.has(f));

/** Split a phrase into normalised tokens, longest phrases first so "so yeah" beats "so". */
function toPhrases(list: readonly string[]): readonly (readonly string[])[] {
  return [...list]
    .map((p) => p.split(' '))
    .sort((a, b) => b.length - a.length);
}

export const DEFINITE_FILLER_PHRASES = toPhrases(DEFINITE_FILLERS);
export const AMBIGUOUS_FILLER_PHRASES = toPhrases(AMBIGUOUS_FILLERS);

/** Lowercase and strip punctuation (keeps apostrophes so "i'm" stays distinct from "im"). */
export function normaliseToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9']/g, '');
}
