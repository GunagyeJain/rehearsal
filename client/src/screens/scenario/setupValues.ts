import { validateUserInputs, type UserInputField, type UserInputValues } from '@rehearsal/shared';

/** Setup answers for this tab only, so a reload of the brief keeps them. Never required to work. */

const KEY_PREFIX = 'rehearsal.setup.';

export function readSetupValues(scenarioId: string): UserInputValues {
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + scenarioId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export function writeSetupValues(scenarioId: string, values: UserInputValues): void {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + scenarioId, JSON.stringify(values));
  } catch {
    // Storage blocked: the values still travel in memory for this visit.
  }
}

/** Remove every saved setup answer in this tab. Called on sign-out so the next account starts clean. */
export function clearAllSetupValues(): void {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (k): k is string => k !== null && k.startsWith(KEY_PREFIX),
    );
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    // Storage blocked: nothing was saved.
  }
}

/** Key of the setup field that the onboarding profile already answers. */
const PROFILE_FIELD_KEY = 'field';

/** Saved answers first; otherwise a 'field' input starts with the field given in onboarding. */
export function initialSetupValues(
  fields: readonly UserInputField[],
  saved: UserInputValues,
  profileField: string | undefined,
): UserInputValues {
  const wantsField = fields.some((f) => f.key === PROFILE_FIELD_KEY && f.type !== 'select');
  if (!wantsField || saved[PROFILE_FIELD_KEY] !== undefined || !profileField?.trim()) return saved;
  return { ...saved, [PROFILE_FIELD_KEY]: profileField.trim() };
}

/** Trimmed values for the declared fields only. */
export function cleanSetupValues(fields: readonly UserInputField[], values: UserInputValues): UserInputValues {
  return Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()]).filter(([, v]) => v !== ''));
}

export function setupIsComplete(fields: readonly UserInputField[], values: UserInputValues): boolean {
  return Object.keys(validateUserInputs(fields, values)).length === 0;
}
