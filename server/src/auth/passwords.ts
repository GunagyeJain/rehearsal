import bcrypt from 'bcryptjs';

/** spec/api.md: bcrypt cost 12. */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * A real cost-12 hash of a random value, compared against when the email is unknown so both
 * failure paths take the same time and cannot be used to probe which emails exist.
 */
let timingDummyHash: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  timingDummyHash ??= bcrypt.hash(`unused-${Math.random().toString(36)}`, BCRYPT_COST);
  return timingDummyHash;
}

/** Compare against the stored hash, or against a dummy hash when there is no user. */
export async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
  const matches = await bcrypt.compare(password, passwordHash ?? (await dummyHash()));
  return passwordHash !== null && matches;
}
