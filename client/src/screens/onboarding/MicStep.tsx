import { useState } from 'react';
import { ArrowRight, Lock, Mic } from 'lucide-react';
import { Button, Icon, InlineNotice } from '../../components';
import { MicDeniedHelp, useMicPermission } from '../../audio';
import { OnboardingFrame } from './OnboardingFrame';
import styles from './Onboarding.module.css';

interface MicStepProps {
  onBack: () => void;
  onGranted: () => void;
}

/** Explains why before the browser prompt appears (never trigger the prompt cold). */
export function MicStep({ onBack, onGranted }: MicStepProps) {
  const mic = useMicPermission();
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);
  const showDenied = denied || mic.state === 'denied';

  const ask = async () => {
    setAsking(true);
    // Always try getUserMedia, even when the Permissions API reports 'denied': some embedded
    // browsers report it wrongly, and a real block simply fails again here.
    const granted = await mic.request();
    setAsking(false);
    if (granted) onGranted();
    else setDenied(true);
  };

  if (mic.state === 'unsupported') {
    return (
      <OnboardingFrame step="mic" title="This browser cannot record audio" onBack={onBack}>
        <InlineNotice tone="fail">
          Rehearsal needs a microphone. Open it in a recent version of Chrome, Edge, Firefox or Safari.
        </InlineNotice>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame
      step="mic"
      title="Next, a short warm-up out loud"
      lead="You will answer one question for about a minute. It shapes your path and is never scored."
      onBack={onBack}
      actions={
        <Button
          icon={mic.state === 'granted' ? ArrowRight : Mic}
          iconPosition={mic.state === 'granted' ? 'end' : 'start'}
          onClick={() => void ask()}
          loading={asking}
        >
          {mic.state === 'granted' ? 'Continue' : showDenied ? 'Retry' : 'Allow microphone'}
        </Button>
      }
    >
      <ul className={styles.reasons} role="list">
        <li>
          <Icon icon={Mic} />
          <span>Your browser will ask to use the microphone. Choose Allow.</span>
        </li>
        <li>
          <Icon icon={Lock} />
          <span>Recordings are private to your account. You can delete them at any time in Settings.</span>
        </li>
      </ul>
      {showDenied && <MicDeniedHelp />}
    </OnboardingFrame>
  );
}
