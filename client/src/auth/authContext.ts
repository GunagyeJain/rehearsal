import { createContext, useContext } from 'react';
import type { CredentialsRequest, User } from '@rehearsal/shared';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'error';

/** Why the boot session check failed, when status is 'error'. */
export type SessionCheckError = 'network' | 'rate-limited' | 'server';

export interface AuthContextValue {
  status: AuthStatus;
  /** Non-null only when status is 'signed-in'. */
  user: User | null;
  /** Non-null only when status is 'error'. */
  sessionError: SessionCheckError | null;
  /**
   * True after the user signed out on purpose (not an expired session), so the next sign-in lands on
   * Home instead of returning to the page they signed out from. Cleared by sign in or sign up.
   */
  signedOutByUser: boolean;
  signIn: (credentials: CredentialsRequest) => Promise<User>;
  signUp: (credentials: CredentialsRequest) => Promise<User>;
  signOut: () => Promise<void>;
  /** Re-run the boot check, e.g. after a network error. */
  reload: () => void;
  /** Replace parts of the signed-in user after a successful update elsewhere (settings, onboarding). */
  updateUser: (update: (user: User) => User) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
