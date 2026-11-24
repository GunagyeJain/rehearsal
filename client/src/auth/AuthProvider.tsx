import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CredentialsRequest, User } from '@rehearsal/shared';
import { isApiError, setUnauthenticatedListener } from '../api/client';
import { fetchMe, signInRequest, signOutRequest, signUpRequest } from './authApi';
import { AuthContext, type AuthContextValue, type AuthStatus, type SessionCheckError } from './authContext';
import { resetAttemptSessions } from '../screens/scenario/attemptSession';
import { clearAllSetupValues } from '../screens/scenario/setupValues';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  sessionError: SessionCheckError | null;
  signedOutByUser: boolean;
}

const LOADING: AuthState = { status: 'loading', user: null, sessionError: null, signedOutByUser: false };
const SIGNED_OUT: AuthState = { status: 'signed-out', user: null, sessionError: null, signedOutByUser: false };

function signedIn(user: User): AuthState {
  return { status: 'signed-in', user, sessionError: null, signedOutByUser: false };
}

/** Classify a failed /auth/me that was not a plain 401. */
function sessionErrorOf(error: unknown): SessionCheckError {
  if (!isApiError(error) || error.status === 0) return 'network';
  if (error.status === 429) return 'rate-limited';
  return 'server';
}

/** Per-account state kept for this tab; dropped whenever the session ends. */
function clearTabState(): void {
  resetAttemptSessions();
  clearAllSetupValues();
}

interface AuthProviderProps {
  children: ReactNode;
}

/** Holds the session: loads /api/auth/me on boot, then tracks sign in, sign up and sign out. */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(LOADING);
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal)
      .then(({ user }) => setState(signedIn(user)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // 401 is the normal signed-out answer; anything else means we could not tell.
        const signedOut = isApiError(error) && error.status === 401;
        setState(signedOut ? SIGNED_OUT : { ...LOADING, status: 'error', sessionError: sessionErrorOf(error) });
      });
    return () => controller.abort();
  }, [bootKey]);

  useEffect(() => {
    setUnauthenticatedListener(() => {
      clearTabState();
      setState(SIGNED_OUT);
    });
    return () => setUnauthenticatedListener(null);
  }, []);

  const signIn = useCallback(async (credentials: CredentialsRequest) => {
    const { user } = await signInRequest(credentials);
    setState(signedIn(user));
    return user;
  }, []);

  const signUp = useCallback(async (credentials: CredentialsRequest) => {
    const { user } = await signUpRequest(credentials);
    setState(signedIn(user));
    return user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } finally {
      // Even if the request failed, stop showing this account on this device.
      clearTabState();
      setState({ ...SIGNED_OUT, signedOutByUser: true });
    }
  }, []);

  const reload = useCallback(() => {
    setState(LOADING);
    setBootKey((key) => key + 1);
  }, []);

  const updateUser = useCallback((update: (user: User) => User) => {
    setState((current) => (current.user ? { ...current, user: update(current.user) } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      sessionError: state.sessionError,
      signedOutByUser: state.signedOutByUser,
      signIn,
      signUp,
      signOut,
      reload,
      updateUser,
    }),
    [state, signIn, signUp, signOut, reload, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
