import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { credentialsSchema, PASSWORD_MIN_LENGTH } from '@rehearsal/shared';
import { Button, Card, IconButton, InlineNotice, PageShell, TextInput } from '../../components';
import { isApiError } from '../../api/client';
import { useAuth } from '../../auth/authContext';
import { SessionPending, type AuthRedirectState } from '../../auth/RequireAuth';
import { ROUTES } from '../../routes';
import styles from './AuthScreen.module.css';

type Mode = 'signin' | 'signup';

interface FieldErrors {
  email?: string;
  password?: string;
}

interface FormError {
  title: string;
  message: string;
}

const COPY: Record<Mode, { title: string; submit: string; switchPrompt: string; switchAction: string }> = {
  signin: {
    title: 'Sign in',
    submit: 'Sign in',
    switchPrompt: 'New to Rehearsal?',
    switchAction: 'Create an account',
  },
  signup: {
    title: 'Create your account',
    submit: 'Create account',
    switchPrompt: 'Already have an account?',
    switchAction: 'Sign in',
  },
};

const EMAIL_INVALID = 'Enter an email address like name@example.com.';
const PASSWORD_TOO_SHORT = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
const PASSWORD_TOO_LONG = 'Use a shorter password: at most 72 characters, fewer with accents or symbols.';
const passwordProblem = (password: string): string =>
  password.length < PASSWORD_MIN_LENGTH ? PASSWORD_TOO_SHORT : PASSWORD_TOO_LONG;
const PASSWORD_RULE = `Use ${PASSWORD_MIN_LENGTH} to 72 characters.`;
const PASSWORD_REQUIRED = 'Enter your password.';

/** Only same-app paths, never the auth screen itself or a protocol-relative URL. */
function safeReturnPath(state: unknown): string {
  const from = typeof state === 'object' && state !== null ? (state as AuthRedirectState).from : undefined;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.startsWith(ROUTES.auth)) {
    return ROUTES.home;
  }
  return from;
}

function validate(mode: Mode, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!credentialsSchema.shape.email.safeParse(email).success) errors.email = EMAIL_INVALID;
  if (password.length === 0) errors.password = PASSWORD_REQUIRED;
  else if (mode === 'signup' && !credentialsSchema.shape.password.safeParse(password).success) {
    errors.password = passwordProblem(password);
  }
  return errors;
}

function describeFailure(error: unknown, mode: Mode): { fields: FieldErrors; form: FormError | null } {
  if (!isApiError(error)) {
    return { fields: {}, form: { title: 'The server could not finish that request', message: 'Try again in a moment.' } };
  }
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return { fields: {}, form: { title: 'Could not sign in', message: error.message } };
    case 'EMAIL_TAKEN':
      return { fields: { email: 'An account with this email already exists.' }, form: null };
    case 'VALIDATION_FAILED':
      return {
        fields: {
          email: error.fields.email ? EMAIL_INVALID : undefined,
          password: error.fields.password ? PASSWORD_RULE : undefined,
        },
        form: null,
      };
    case 'RATE_LIMITED':
      return { fields: {}, form: { title: 'Too many attempts', message: error.message } };
    case 'NETWORK_ERROR':
      return { fields: {}, form: { title: 'Could not reach the server', message: error.message } };
    default:
      return {
        fields: {},
        form: {
          title: mode === 'signin' ? 'Could not sign in' : 'Could not create your account',
          message: 'The server could not finish that request. Try again in a moment.',
        },
      };
  }
}

/** spec/screens.md section 1: single centred card, email and password, sign in / sign up toggle. */
export function AuthScreen() {
  const { status, signIn, signUp } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const copy = COPY[mode];

  // Move focus to whatever needs attention after a failed submit.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest === 0) return;
    if (fieldErrors.email) emailRef.current?.focus();
    else if (fieldErrors.password) passwordRef.current?.focus();
    else if (formError) alertRef.current?.focus();
  }, [focusRequest, fieldErrors, formError]);

  if (status === 'loading' || status === 'error') return <SessionPending />;
  if (status === 'signed-in') return <Navigate to={safeReturnPath(location.state)} replace />;

  function switchMode() {
    setMode((current) => (current === 'signin' ? 'signup' : 'signin'));
    setFieldErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors = validate(mode, email, password);
    setFormError(null);
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setFocusRequest((n) => n + 1);
      return;
    }
    setSubmitting(true);
    try {
      const credentials = { email, password };
      // On success the auth state flips to signed-in and the redirect above takes over.
      await (mode === 'signin' ? signIn(credentials) : signUp(credentials));
    } catch (error: unknown) {
      const failure = describeFailure(error, mode);
      setFieldErrors(failure.fields);
      setFormError(failure.form);
      setSubmitting(false);
      setFocusRequest((n) => n + 1);
    }
  }

  return (
    <PageShell
      title={copy.title}
      header="minimal"
      centered
      lead="Practise speaking in the situations that matter to you, and see exactly how you did."
    >
      <Card padding="lg" className={styles.card}>
        <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={submitting || undefined}>
          {formError && (
            <div ref={alertRef} tabIndex={-1} className={styles.alert}>
              <InlineNotice tone="fail" title={formError.title}>
                {formError.message}
              </InlineNotice>
            </div>
          )}

          <TextInput
            ref={emailRef}
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            disabled={submitting}
          />

          {mode === 'signup' && fieldErrors.email && (
            <p className={styles.inlineSwitch}>
              <button type="button" className={styles.textButton} onClick={switchMode}>
                Sign in instead
              </button>
            </p>
          )}

          <TextInput
            ref={passwordRef}
            label="Password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={mode === 'signup' ? PASSWORD_MIN_LENGTH : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={mode === 'signup' && !fieldErrors.password ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
            error={fieldErrors.password}
            disabled={submitting}
            trailing={
              <IconButton
                icon={showPassword ? EyeOff : Eye}
                label={showPassword ? 'Hide password' : 'Show password'}
                pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              />
            }
          />

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            {copy.submit}
          </Button>
        </form>

        <p className={styles.switch}>
          <span>{copy.switchPrompt}</span>{' '}
          <button type="button" className={styles.textButton} onClick={switchMode} disabled={submitting}>
            {copy.switchAction}
          </button>
        </p>
      </Card>
    </PageShell>
  );
}
