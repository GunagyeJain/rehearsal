import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, UserX } from 'lucide-react';
import { Button, Card, CardHeader, Dialog, TextInput } from '../../components';
import { isApiError } from '../../api/client';
import { deleteAccount } from '../../api/libraryApi';
import { useAuth } from '../../auth/authContext';
import { ROUTES } from '../../routes';
import styles from './SettingsScreen.module.css';

function deleteErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'INVALID_CREDENTIALS') return 'That password is not right. Try again.';
  if (isApiError(error)) return error.message;
  return 'Your account was not deleted. Retry in a moment.';
}

/** Danger confirm: the account goes only after the password is typed and checked by the server. */
function DeleteAccount() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);

  function close() {
    setOpen(false);
    setPassword('');
    setError(undefined);
  }

  async function confirm() {
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    setDeleting(true);
    setError(undefined);
    try {
      await deleteAccount({ password });
      // The server already cleared the session; this drops the local signed-in state too.
      await signOut();
      navigate(ROUTES.auth, { replace: true });
    } catch (caught: unknown) {
      setError(deleteErrorMessage(caught));
      setDeleting(false);
    }
  }

  return (
    <>
      <div className={styles.dangerRow}>
        <div>
          <p className={styles.rowTitle}>Delete account</p>
          <p className={styles.rowHint}>Removes your path, attempts, recordings and settings. This cannot be undone.</p>
        </div>
        <Button variant="danger" icon={UserX} onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>
      <Dialog
        open={open}
        tone="danger"
        title="Delete your account?"
        description="Everything goes for good: your path, every attempt and recording, and your settings."
        confirmLabel="Delete account"
        confirmLoading={deleting}
        onConfirm={() => void confirm()}
        onCancel={close}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <TextInput
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            error={error}
            onChange={(event) => setPassword(event.target.value)}
          />
        </form>
      </Dialog>
    </>
  );
}

/** Signed-in email, sign out and account deletion. */
export function AccountSection() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    navigate(ROUTES.auth, { replace: true });
  }

  return (
    <Card as="section" padding="lg" aria-labelledby="account-heading">
      <CardHeader id="account-heading" title="Account" />
      <div className={styles.account}>
        <p className={styles.email}>{user?.email}</p>
        <Button variant="secondary" icon={LogOut} onClick={handleSignOut} loading={signingOut}>
          Sign out
        </Button>
      </div>
      <DeleteAccount />
    </Card>
  );
}
