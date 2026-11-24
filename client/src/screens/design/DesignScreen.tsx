import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Mic,
  PanelTopClose,
  Play,
  RotateCcw,
  SkipForward,
  Trash2,
  Volume2,
} from 'lucide-react';
import { CONFIDENCE_LABELS, GOAL_OPTIONS, TIMEFRAME_OPTIONS } from '@rehearsal/shared';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  InlineNotice,
  LoadingState,
  PageShell,
  ProgressRule,
  RadioCards,
  Scale,
  SegmentedControl,
  Select,
  Spinner,
  Textarea,
  TextInput,
} from '../../components';
import { FONT_OPTIONS, THEME_OPTIONS } from '../../theme/appearance';
import { useTheme } from '../../theme/themeContext';
import styles from './DesignScreen.module.css';
import { WaveformDemo } from './WaveformDemo';

const SURFACE_TOKENS = ['--bg', '--bg-raised', '--bg-sunken', '--border', '--border-strong'] as const;
const TEXT_TOKENS = ['--text', '--text-muted', '--text-faint'] as const;
const SEMANTIC_TOKENS = [
  { token: '--speaker-ai', role: 'The AI speaking' },
  { token: '--speaker-user', role: 'You speaking' },
  { token: '--warn', role: 'Long pauses, cautions' },
  { token: '--fail', role: 'Fillers, unmet criteria' },
  { token: '--pass', role: 'Met criteria' },
] as const;
const TYPE_SCALE = [
  { token: '--size-2xl', use: 'The AI line on the live screen', sample: 'Tell me about yourself.' },
  { token: '--size-xl', use: 'Scene text and page titles', sample: 'A hiring manager is ready for you.' },
  { token: '--size-lg', use: 'Section headings', sample: 'Pass criteria' },
  { token: '--size-md', use: 'Body', sample: 'Keep your answer under ninety seconds and lead with your strongest point.' },
  { token: '--size-sm', use: 'Secondary text, history', sample: 'Attempt 2 of 3, yesterday' },
  { token: '--size-xs', use: 'Labels and metric units', sample: 'WPM' },
] as const;
const SPACE_STEPS = Array.from({ length: 12 }, (_, i) => `--space-${i + 1}`);

const goalOptions = GOAL_OPTIONS.slice(0, 4).map((goal) => ({ value: goal.id, label: goal.label }));
const timeframeOptions = TIMEFRAME_OPTIONS.map((t) => ({ value: t.id, label: t.label }));

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({ token, caption }: { token: string; caption?: string }) {
  return (
    <div className={styles.swatch}>
      <span className={styles.chip} style={{ '--chip': `var(${token})` } as CSSProperties} />
      <code className={styles.token}>{token}</code>
      {caption && <span className={styles.caption}>{caption}</span>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowItems}>{children}</div>
    </div>
  );
}

/** Dev-only kitchen sink: every component in every state, under both themes and all fonts. */
export function DesignScreen() {
  const { theme, font, setTheme, setFont, resolvedTheme } = useTheme();
  const [goal, setGoal] = useState<string | null>('job-interview');
  const [timeframe, setTimeframe] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(3);
  const [step, setStep] = useState(3);
  const [dialog, setDialog] = useState<'none' | 'leave' | 'delete'>('none');
  const [deleting, setDeleting] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [transcriptShown, setTranscriptShown] = useState(true);

  function confirmDelete() {
    setDeleting(true);
    window.setTimeout(() => {
      setDeleting(false);
      setDialog('none');
    }, 1200);
  }

  return (
    <PageShell
      title="Design system"
      eyebrow="Development only"
      lead="Every token and component in every state. Switch theme and font to review both."
      width="wide"
    >
      <div className={styles.toolbar}>
        <SegmentedControl legend="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        <SegmentedControl legend="Font" options={FONT_OPTIONS} value={font} onChange={setFont} />
        <p className={styles.toolbarNote}>Showing {resolvedTheme}</p>
      </div>

      <Section id="type" title="Typography">
        <div className={styles.typeList}>
          {TYPE_SCALE.map((entry) => (
            <div key={entry.token} className={styles.typeRow}>
              <div className={styles.typeMeta}>
                <code className={styles.token}>{entry.token}</code>
                <span className={styles.caption}>{entry.use}</span>
              </div>
              <p className={styles.typeSample} style={{ '--sample-size': `var(${entry.token})` } as CSSProperties}>
                {entry.sample}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="colour" title="Colour">
        <p className={styles.note}>Monochrome surfaces. Five functional colours, and nothing else.</p>
        <div className={styles.swatchGrid}>
          {SURFACE_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
          {TEXT_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
        <div className={styles.swatchGrid}>
          {SEMANTIC_TOKENS.map((entry) => (
            <Swatch key={entry.token} token={entry.token} caption={entry.role} />
          ))}
        </div>
      </Section>

      <Section id="space" title="Spacing and radius">
        <div className={styles.spaceList}>
          {SPACE_STEPS.map((token) => (
            <div key={token} className={styles.spaceRow}>
              <code className={styles.token}>{token}</code>
              <span className={styles.spaceBar} style={{ '--bar': `var(${token})` } as CSSProperties} />
            </div>
          ))}
        </div>
        <div className={styles.radii}>
          {['--radius-sm', '--radius-md', '--radius-lg'].map((token) => (
            <div key={token} className={styles.radius} style={{ '--r': `var(${token})` } as CSSProperties}>
              <code className={styles.token}>{token}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section id="waveform" title="Waveform">
        <p className={styles.note}>
          The live strip runs on a synthetic analyser; the playback strip on synthetic peaks with fillers, long
          pauses and a pace drift range. Scrub with a pointer or the arrow keys.
        </p>
        <WaveformDemo />
      </Section>

      <Section id="buttons" title="Buttons">
        <Row label="Variants">
          <Button icon={Play}>Begin</Button>
          <Button variant="secondary" icon={RotateCcw}>
            Retry
          </Button>
          <Button variant="ghost" icon={SkipForward}>
            Skip for now
          </Button>
          <Button variant="danger" icon={Trash2}>
            Delete all recordings
          </Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm">Done</Button>
          <Button size="md">Done</Button>
          <Button size="lg" icon={ArrowRight} iconPosition="end">
            Continue
          </Button>
        </Row>
        <Row label="States">
          <Button loading>Saving</Button>
          <Button variant="secondary" loading>
            Retrying
          </Button>
          <Button disabled>Begin</Button>
          <Button variant="secondary" disabled>
            Retry
          </Button>
        </Row>
        <Row label="Full width">
          <Button fullWidth size="lg" icon={Mic}>
            Allow microphone
          </Button>
        </Row>
        <Row label="Icon buttons">
          <IconButton icon={ChevronLeft} label="Back" />
          <IconButton icon={Volume2} label="Play the question again" variant="secondary" />
          <IconButton
            icon={PanelTopClose}
            label={transcriptShown ? 'Hide transcript' : 'Show transcript'}
            pressed={transcriptShown}
            onClick={() => setTranscriptShown((v) => !v)}
          />
          <IconButton icon={Trash2} label="Delete recording" disabled />
        </Row>
      </Section>

      <Section id="fields" title="Fields">
        <div className={styles.formGrid}>
          <TextInput label="Email" type="email" placeholder="you@example.com" autoComplete="email" />
          <TextInput label="Password" type="password" hint="At least 8 characters." autoComplete="new-password" />
          <TextInput
            label="Email"
            type="email"
            defaultValue="name@"
            error="Enter a full email address, like name@example.com."
          />
          <TextInput label="Field" labelAside="Optional" placeholder="Mechanical engineering" />
          <Select
            label="Timeframe"
            options={timeframeOptions}
            placeholder="Choose one"
            defaultValue=""
          />
          <TextInput label="Disabled" defaultValue="dev@rehearsal.local" disabled />
        </div>
        <Textarea label="Your project" hint="One or two sentences is enough." placeholder="A sensor network for..." />
      </Section>

      <Section id="choices" title="Choices">
        <div className={styles.twoCol}>
          <RadioCards
            legend="What are you preparing for?"
            options={goalOptions}
            value={goal}
            onChange={setGoal}
          />
          <div className={styles.stack}>
            <RadioCards
              legend="When is it?"
              options={timeframeOptions}
              value={timeframe}
              onChange={setTimeframe}
              error={timeframe ? undefined : 'Choose one to continue.'}
            />
            <Scale
              legend="How confident do you feel speaking in that situation?"
              lowLabel={CONFIDENCE_LABELS.low}
              highLabel={CONFIDENCE_LABELS.high}
              value={confidence}
              onChange={setConfidence}
            />
          </div>
        </div>
      </Section>

      <Section id="progress" title="Progress rule">
        <div className={styles.progressDemo}>
          <ProgressRule value={step} total={8} label="Onboarding progress" />
          <div className={styles.rowItems}>
            <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
            <Button size="sm" onClick={() => setStep((s) => Math.min(8, s + 1))}>
              Next
            </Button>
            <span className={styles.caption}>Step {step} of 8</span>
          </div>
        </div>
      </Section>

      <Section id="feedback" title="Notices and states">
        <div className={styles.stack}>
          <InlineNotice tone="info" title="Recordings are private">
            Only you can play them back. Delete them at any time in Settings.
          </InlineNotice>
          <InlineNotice tone="warn" title="Long pause">
            A 3.4 second pause after your first sentence.
          </InlineNotice>
          <InlineNotice tone="pass" title="Pace: 142 wpm">
            Target 120 to 170.
          </InlineNotice>
          {noticeVisible && (
            <InlineNotice tone="fail" title="Microphone access is blocked" onDismiss={() => setNoticeVisible(false)}>
              Enable it in your browser site settings and reload.
            </InlineNotice>
          )}
        </div>
        <div className={styles.threeCol}>
          <Card tone="outline">
            <LoadingState message="Loading your path" />
          </Card>
          <EmptyState
            icon={Check}
            title="Your first attempt will appear here."
            action={<Button variant="secondary">Explore scenarios</Button>}
          />
          <ErrorState
            title="Your path could not be generated."
            message="A default path is ready instead, or retry for a personalised one."
            onRetry={() => undefined}
          />
        </div>
        <Row label="Spinners">
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </Row>
      </Section>

      <Section id="dialogs" title="Dialogs">
        <Row label="Confirm">
          <Button variant="secondary" onClick={() => setDialog('leave')}>
            Leave scenario
          </Button>
          <Button variant="danger" icon={Trash2} onClick={() => setDialog('delete')}>
            Delete all recordings
          </Button>
        </Row>
      </Section>

      <Section id="cards" title="Cards and icons">
        <div className={styles.threeCol}>
          <Card>
            <CardHeader eyebrow="Fundamentals" title="Self-introduction" level={3} />
            <p className={styles.caption}>Two turns, about two minutes.</p>
          </Card>
          <Card tone="sunken">
            <CardHeader eyebrow="Professional" title="Daily standup" level={3} />
            <p className={styles.caption}>Sunken surface.</p>
          </Card>
          <Card tone="outline">
            <CardHeader eyebrow="Outline" title="Path complete" level={3} />
            <p className={styles.caption}>Outline surface.</p>
          </Card>
        </div>
        <Row label="Icon sizes">
          <Icon icon={Mic} size="sm" label="Microphone, small" />
          <Icon icon={Mic} label="Microphone" />
          <Icon icon={Mic} size="lg" label="Microphone, large" />
        </Row>
      </Section>

      <Dialog
        open={dialog === 'leave'}
        title="Leave this scenario?"
        description="Turns you have already answered are kept. You can pick it up again from your path."
        confirmLabel="Leave scenario"
        cancelLabel="Keep going"
        onConfirm={() => setDialog('none')}
        onCancel={() => setDialog('none')}
      />
      <Dialog
        open={dialog === 'delete'}
        tone="danger"
        title="Delete all recordings?"
        description="This removes every recording on your account. Reports and transcripts stay. This cannot be undone."
        confirmLabel="Delete all"
        onConfirm={confirmDelete}
        onCancel={() => setDialog('none')}
        confirmLoading={deleting}
      />
    </PageShell>
  );
}
