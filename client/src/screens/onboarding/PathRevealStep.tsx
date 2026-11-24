import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { GeneratePathResponse } from '@rehearsal/shared';
import { isApiError } from '../../api/client';
import { Button, ErrorState, Spinner } from '../../components';
import { PathList } from '../../path/PathList';
import { generatePath } from '../../path/pathApi';
import { OnboardingFrame } from './OnboardingFrame';
import styles from './Onboarding.module.css';

interface PathRevealStepProps {
  onBack: () => void;
  /** Leave onboarding: to the first scenario, or to the path on Home. */
  onFinish: (destination: 'first' | 'home', firstScenarioId: string | null) => void;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: GeneratePathResponse };

/** Generates (once, idempotently) and reveals the path, first item highlighted. */
export function PathRevealStep({ onBack, onFinish }: PathRevealStepProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    generatePath()
      .then((data) => {
        if (!cancelled) setLoad({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoad({
          status: 'error',
          message: isApiError(error) ? error.message : 'Your path could not be built. Retry in a moment.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  if (load.status === 'loading') {
    return (
      <OnboardingFrame step="path" title="Building your path" onBack={onBack} lead="Choosing and ordering scenarios for your goal. This takes a few seconds.">
        <div className={styles.building}>
          <Spinner label="Building your path" size="lg" />
        </div>
      </OnboardingFrame>
    );
  }

  if (load.status === 'error') {
    return (
      <OnboardingFrame step="path" title="Your path is not ready yet" onBack={onBack}>
        <ErrorState title="Could not build your path" message={load.message} onRetry={retry} />
      </OnboardingFrame>
    );
  }

  const { path, fallback } = load.data;
  const first = path.items[0] ?? null;
  return (
    <OnboardingFrame
      step="path"
      title="Your path"
      // Back is always available (spec/screens.md section 2); the path stays fixed, generation is idempotent.
      onBack={onBack}
      lead={
        <>
          {path.totalCount} scenarios, easiest first. Each unlocks when you pass the one before it, and you can skip any
          scenario after three tries.
          {fallback && <span className={styles.fallbackNote}> This is the standard path for your goal.</span>}
        </>
      }
      actions={
        <>
          {first && (
            <Button icon={ArrowRight} iconPosition="end" onClick={() => onFinish('first', first.scenarioId)}>
              Begin {first.title}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onFinish('home', null)}>
            Go to your path
          </Button>
        </>
      }
    >
      <PathList items={path.items} variant="reveal" label="Your path" />
    </OnboardingFrame>
  );
}
