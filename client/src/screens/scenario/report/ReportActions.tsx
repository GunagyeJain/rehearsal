import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Home, RotateCcw, SkipForward } from 'lucide-react';
import type { AttemptDetailResponse } from '@rehearsal/shared';
import { isApiError } from '../../../api/client';
import { Button, InlineNotice } from '../../../components';
import { skipPathItem } from '../scenarioApi';
import type { VerdictState } from './reportModel';
import styles from './Report.module.css';

interface ReportActionsProps {
  detail: AttemptDetailResponse;
  verdict: VerdictState;
}

/** Where to go after this scenario clears: the next path item's brief, or home at the end of the path. */
function nextHref(nextScenarioId: string | null): string {
  return nextScenarioId ? `/scenarios/${encodeURIComponent(nextScenarioId)}/brief` : '/';
}

/**
 * Report actions (spec/screens.md): Retry always; Continue to the next path item once passed (home
 * when off the path or at its end); Skip for now from the third attempt that has not passed.
 * Reattempting is always allowed, including after a pass or a skip.
 */
export function ReportActions({ detail, verdict }: ReportActionsProps) {
  const navigate = useNavigate();
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const { progress } = detail;
  const scenarioId = detail.scenario.id;
  const passed = verdict === 'passed';
  const canSkip = verdict === 'not-yet' && progress.canSkip;
  const continueToNext = passed && progress.onPath && progress.nextScenarioId !== null;

  const skip = async () => {
    setSkipping(true);
    setSkipError(null);
    try {
      await skipPathItem(scenarioId);
      navigate(nextHref(progress.nextScenarioId));
    } catch (error: unknown) {
      setSkipping(false);
      setSkipError(isApiError(error) ? error.message : 'The skip was not saved. Check your connection and retry.');
    }
  };

  return (
    <div className={styles.actions}>
      {passed && (
        <Button
          size="lg"
          icon={continueToNext ? ArrowRight : Home}
          iconPosition={continueToNext ? 'end' : 'start'}
          onClick={() => navigate(continueToNext ? nextHref(progress.nextScenarioId) : '/')}
        >
          {continueToNext ? 'Continue' : 'Back to home'}
        </Button>
      )}
      <Button
        size="lg"
        variant={passed ? 'secondary' : 'primary'}
        icon={RotateCcw}
        onClick={() => navigate(`/scenarios/${encodeURIComponent(scenarioId)}/brief`)}
      >
        Retry
      </Button>
      {canSkip && (
        <Button size="lg" variant="ghost" icon={SkipForward} loading={skipping} onClick={() => void skip()}>
          Skip for now
        </Button>
      )}
      {canSkip && !skipError && (
        <p className={styles.skipHint}>Skipping opens the next scenario. You can come back to this one any time.</p>
      )}
      {skipError && (
        <InlineNotice tone="warn" title="Skip did not go through.">
          {skipError}
        </InlineNotice>
      )}
    </div>
  );
}
