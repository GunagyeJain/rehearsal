import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ErrorState, LoadingState } from '../components';
import { ROUTES } from '../routes';
import { useAuth, type SessionCheckError } from './authContext';
import styles from './RequireAuth.module.css';

/** Where the auth screen sends the user back to after signing in. */
export interface AuthRedirectState {
  from?: string;
}

export type OnboardingRule = 'required' | 'pending' | 'any';

interface RequireAuthProps {
  /**
   * 'required': only onboarded users (others go to /onboarding).
   * 'pending': only users still onboarding (onboarded users go home).
   * 'any': every signed-in user.
   */
  onboarding?: OnboardingRule;
  children: ReactNode;
}

const SESSION_ERROR_COPY: Record<SessionCheckError, { title: string; message: string }> = {
  network: { title: 'Could not reach the server', message: 'Check your connection, then retry.' },
  'rate-limited': { title: 'Too many requests', message: 'The server asked us to slow down. Wait a minute, then retry.' },
  server: { title: 'The server had a problem', message: 'It is not your connection. Retry in a moment.' },
};

/** Quiet full-screen states while the session is being checked. */
export function SessionPending() {
  const { status, sessionError, reload } = useAuth();
  const copy = SESSION_ERROR_COPY[sessionError ?? 'network'];
  return (
    <div className={styles.pending}>
      {status === 'error' ? (
        <ErrorState title={copy.title} message={copy.message} onRetry={reload} />
      ) : (
        <LoadingState message="Loading" />
      )}
    </div>
  );
}

/** Protected route wrapper: signed-out users go to /auth and come back here after signing in. */
export function RequireAuth({ onboarding = 'required', children }: RequireAuthProps) {
  const { status, user, signedOutByUser } = useAuth();
  const location = useLocation();

  if (status === 'loading' || status === 'error') return <SessionPending />;
  if (!user) {
    // After an explicit sign-out, the next sign-in starts at Home rather than the page signed out from.
    if (signedOutByUser) return <Navigate to={ROUTES.auth} replace />;
    const state: AuthRedirectState = { from: `${location.pathname}${location.search}${location.hash}` };
    return <Navigate to={ROUTES.auth} replace state={state} />;
  }
  if (onboarding === 'required' && !user.onboarded) return <Navigate to={ROUTES.onboarding} replace />;
  if (onboarding === 'pending' && user.onboarded) return <Navigate to={ROUTES.home} replace />;
  return <>{children}</>;
}
