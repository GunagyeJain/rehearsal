import { InlineNotice } from '../components';
import { micHelpFor } from './micHelp';
import styles from './MicDeniedHelp.module.css';

/** Recovery instructions for a blocked microphone, for the browser in use (spec/screens.md section 2). */
export function MicDeniedHelp() {
  const help = micHelpFor(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return (
    <InlineNotice tone="warn" title="Microphone access is blocked">
      <p className={styles.helpLead}>To allow it in {help.browser}:</p>
      <ol className={styles.helpSteps}>
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </InlineNotice>
  );
}
