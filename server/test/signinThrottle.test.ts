import { describe, expect, it } from 'vitest';
import { createSigninThrottle } from '../src/auth/signinThrottle';

describe('createSigninThrottle', () => {
  it('locks after the limit inside the window and unlocks once the window passes', () => {
    const throttle = createSigninThrottle(3, 1_000);
    throttle.recordFailure('a@test.local', 0);
    throttle.recordFailure('a@test.local', 100);
    expect(throttle.isLocked('a@test.local', 200)).toBe(false);
    throttle.recordFailure('a@test.local', 300);
    expect(throttle.isLocked('a@test.local', 400)).toBe(true);
    expect(throttle.isLocked('b@test.local', 400)).toBe(false);
    expect(throttle.isLocked('a@test.local', 1_000)).toBe(false);
  });

  it('clears the count on a successful sign-in', () => {
    const throttle = createSigninThrottle(2, 1_000);
    throttle.recordFailure('a@test.local', 0);
    throttle.recordSuccess('a@test.local');
    throttle.recordFailure('a@test.local', 10);
    expect(throttle.isLocked('a@test.local', 20)).toBe(false);
  });
});
