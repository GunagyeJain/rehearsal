import { useRef, useState } from 'react';
import { Card, CardHeader, InlineNotice, PageShell, SegmentedControl } from '../../components';
import { patchSettings } from '../../auth/authApi';
import { useAuth } from '../../auth/authContext';
import { FONT_OPTIONS, THEME_OPTIONS } from '../../theme/appearance';
import { useTheme } from '../../theme/themeContext';
import { AccountSection } from './AccountSection';
import { RecordingsSection } from './RecordingsSection';
import styles from './SettingsScreen.module.css';

type TranscriptChoice = 'on' | 'off';

const TRANSCRIPT_OPTIONS: readonly { value: TranscriptChoice; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/** The conversation history on the live screen. Saved to the account at once. */
function TranscriptPreference() {
  const { user, updateUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  // Only the newest PATCH may write back, so a late response never reverts a later choice.
  const latestRequest = useRef(0);
  const value: TranscriptChoice = user?.settings.showTranscript === false ? 'off' : 'on';

  function change(next: TranscriptChoice) {
    const showTranscript = next === 'on';
    const previous = user?.settings.showTranscript ?? true;
    latestRequest.current += 1;
    const requestId = latestRequest.current;
    // Only showTranscript is written back, so theme and font changes made meanwhile are kept.
    const apply = (value: boolean) => updateUser((u) => ({ ...u, settings: { ...u.settings, showTranscript: value } }));
    setError(null);
    apply(showTranscript);
    patchSettings({ showTranscript })
      .then(({ settings }) => {
        if (requestId === latestRequest.current) apply(settings.showTranscript);
      })
      .catch(() => {
        if (requestId !== latestRequest.current) return;
        apply(previous);
        setError('Check your connection and try again.');
      });
  }

  return (
    <Card as="section" padding="lg" aria-labelledby="scenarios-heading">
      <CardHeader id="scenarios-heading" title="During scenarios" />
      <SegmentedControl legend="Show transcript during scenarios" options={TRANSCRIPT_OPTIONS} value={value} onChange={change} />
      <p className={styles.rowHint}>
        Earlier questions and your answers stay visible above the current line. You can also hide them from the live
        screen.
      </p>
      {error && (
        <InlineNotice tone="fail" title="That change was not saved.">
          {error}
        </InlineNotice>
      )}
    </Card>
  );
}

export function SettingsScreen() {
  const { theme, font, setTheme, setFont } = useTheme();

  return (
    <PageShell title="Settings">
      <div className={styles.stack}>
        <Card as="section" padding="lg" aria-labelledby="appearance-heading">
          <CardHeader id="appearance-heading" title="Appearance" />
          <div className={styles.controls}>
            <SegmentedControl legend="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
            <SegmentedControl legend="Font" options={FONT_OPTIONS} value={font} onChange={setFont} />
          </div>
          <figure className={styles.sample}>
            <figcaption className={styles.sampleLabel}>Preview</figcaption>
            <p className={styles.sampleText}>Tell me who you are and what you are preparing for.</p>
          </figure>
        </Card>
        <TranscriptPreference />
        <RecordingsSection />
        <AccountSection />
      </div>
    </PageShell>
  );
}
