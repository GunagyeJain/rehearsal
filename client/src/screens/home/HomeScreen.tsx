import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Compass, History, Settings } from 'lucide-react';
import { GOAL_OPTIONS, type PathView, type UserProfile } from '@rehearsal/shared';
import { isApiError } from '../../api/client';
import { useAuth } from '../../auth/authContext';
import { Card, ErrorState, Icon, LoadingState, PageShell } from '../../components';
import { ROUTES } from '../../routes';
import { PathList } from '../../path/PathList';
import { getPath } from '../../path/pathApi';
import styles from './HomeScreen.module.css';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; path: PathView | null };

function goalLine(profile: UserProfile | null): string | undefined {
  if (!profile) return undefined;
  if (profile.goal === 'other') return profile.goalDetail ? `Preparing for: ${profile.goalDetail}` : undefined;
  const option = GOAL_OPTIONS.find((g) => g.id === profile.goal);
  return option ? `Preparing for ${option.label.charAt(0).toLowerCase()}${option.label.slice(1)}` : undefined;
}

function usePath(): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getPath(controller.signal)
      .then(({ path }) => setLoad({ status: 'ready', path }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: 'error', message: isApiError(error) ? error.message : 'Your path could not be loaded.' });
      });
    return () => controller.abort();
  }, [nonce]);

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  return { load, retry };
}

function Footer() {
  const links = [
    { to: ROUTES.explore, label: 'Explore the library', icon: Compass },
    { to: ROUTES.history, label: 'History', icon: History },
    { to: ROUTES.settings, label: 'Settings', icon: Settings },
  ] as const;
  return (
    <nav aria-label="More" className={styles.footerNav}>
      {links.map((link) => (
        <Link key={link.to} to={link.to} className={styles.footerLink}>
          <Icon icon={link.icon} size="sm" />
          <span>{link.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Progress({ path }: { path: PathView }) {
  return (
    <p className={styles.count} aria-label={`${path.clearedCount} of ${path.totalCount} cleared`}>
      <span className={styles.countValue}>{path.clearedCount}</span>
      <span className={styles.countOf}> of {path.totalCount}</span>
    </p>
  );
}

function CompleteCard({ path }: { path: PathView }) {
  const passed = path.items.filter((i) => i.state === 'passed').length;
  const skipped = path.totalCount - passed;
  return (
    <Card as="section" padding="lg" className={styles.complete} aria-labelledby="path-complete">
      <p className={styles.completeEyebrow}>Path complete</p>
      <h2 id="path-complete" className={styles.completeTitle}>
        You cleared all {path.totalCount} scenarios.
      </h2>
      <p className={styles.completeBody}>
        {passed} passed{skipped > 0 ? `, ${skipped} skipped` : ''}. Everything stays open: retry any scenario to see
        your numbers move, or try something new.
      </p>
      <Link to={ROUTES.explore} className={styles.completeAction}>
        <span>Explore the library</span>
        <Icon icon={ArrowRight} size="sm" />
      </Link>
    </Card>
  );
}

function leadFor(path: PathView): string {
  if (path.complete) return 'Every scenario on your path is cleared.';
  const current = path.items.find((i) => i.isCurrent);
  const fresh = path.items.every((i) => i.attemptCount === 0 && i.state !== 'skipped');
  if (fresh && current) {
    return `Start with ${current.title}. You will see the goal and every pass criterion before you record.`;
  }
  if (current?.state === 'failed') return `Not yet on ${current.title}. Retry when you are ready.`;
  return current ? `Up next: ${current.title}.` : 'Pick up where you left off.';
}

/** Home: the fixed path, state derived on the server (spec/screens.md section 3). */
export function HomeScreen() {
  const { user, updateUser } = useAuth();
  const { load, retry } = usePath();
  const noPath = load.status === 'ready' && load.path === null;

  useEffect(() => {
    // The server has no path for this account: onboarding is not actually finished.
    if (noPath) updateUser((current) => ({ ...current, onboarded: false }));
  }, [noPath, updateUser]);

  if (noPath) return <Navigate to={ROUTES.onboarding} replace />;

  if (load.status !== 'ready' || load.path === null) {
    return (
      <PageShell title="Your path" header="minimal" footer={<Footer />}>
        {load.status === 'error' ? (
          <ErrorState title="Could not load your path" message={load.message} onRetry={retry} />
        ) : (
          <LoadingState message="Loading your path" />
        )}
      </PageShell>
    );
  }

  const { path } = load;
  return (
    <PageShell
      title="Your path"
      eyebrow={goalLine(user?.profile ?? null)}
      lead={leadFor(path)}
      aside={<Progress path={path} />}
      header="minimal"
      footer={<Footer />}
    >
      <div className={styles.stack}>
        {path.complete && <CompleteCard path={path} />}
        <PathList items={path.items} variant="home" label="Path scenarios" />
      </div>
    </PageShell>
  );
}
