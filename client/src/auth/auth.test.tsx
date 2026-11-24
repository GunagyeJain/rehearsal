import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type User } from '@rehearsal/shared';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { useTheme } from '../theme/themeContext';
import { AccountThemeProvider } from './AccountThemeProvider';
import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';
import { useAuth } from './authContext';

const USER: User = {
  id: '0123456789abcdef01234567',
  email: 'me@example.com',
  createdAt: '2026-11-23T00:00:00.000Z',
  profile: null,
  settings: { ...DEFAULT_SETTINGS, theme: 'dark', font: 'mono' },
  onboarded: false,
};

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function unauthenticated(): Response {
  return json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }, 401);
}

function mockApi(route: Route) {
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => route(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function ThemeProbe() {
  const { theme, font, setTheme } = useTheme();
  return (
    <div>
      <p data-testid="appearance">{`${theme}/${font}`}</p>
      <button type="button" onClick={() => setTheme('light')}>
        Light
      </button>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}

function renderApp(initialPath: string) {
  const router = createMemoryRouter(
    [
      { path: '/auth', element: <AuthScreen /> },
      { path: '/', element: <RequireAuth><p>Home screen</p></RequireAuth> },
      { path: '/history', element: <RequireAuth><p>History screen</p></RequireAuth> },
      { path: '/settings', element: <RequireAuth><p>Settings screen</p><SignOutButton /></RequireAuth> },
      {
        path: '/onboarding',
        element: (
          <RequireAuth onboarding="pending">
            <p>Onboarding screen</p>
            <ThemeProbe />
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(
    <AuthProvider>
      <AccountThemeProvider>
        <RouterProvider router={router} />
      </AccountThemeProvider>
    </AuthProvider>,
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RequireAuth', () => {
  it('sends a signed-out visitor to /auth and back to the page they wanted after sign in', async () => {
    const fetchMock = mockApi((url) => {
      if (url === '/api/auth/me') return unauthenticated();
      if (url === '/api/auth/signin') return json({ user: { ...USER, onboarded: true } });
      throw new Error(`unexpected ${url}`);
    });
    const router = renderApp('/history');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long enough' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('History screen')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/history');
    const signinCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/signin');
    expect(JSON.parse(String(signinCall?.[1]?.body))).toEqual({ email: 'me@example.com', password: 'long enough' });
  });

  it('routes a signed-in user without a path to onboarding and seeds the theme from their settings', async () => {
    mockApi((url) => {
      if (url === '/api/auth/me') return json({ user: USER });
      throw new Error(`unexpected ${url}`);
    });
    const router = renderApp('/');
    expect(await screen.findByText('Onboarding screen')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/onboarding');
    await waitFor(() => expect(screen.getByTestId('appearance').textContent).toBe('dark/mono'));
  });

  it('saves a theme change to the account while signed in', async () => {
    const fetchMock = mockApi((url, init) => {
      if (url === '/api/auth/me') return json({ user: USER });
      if (url === '/api/users/me/settings' && init.method === 'PATCH') {
        return json({ settings: { ...USER.settings, theme: 'light' } });
      }
      throw new Error(`unexpected ${url}`);
    });
    renderApp('/onboarding');
    await waitFor(() => expect(screen.getByTestId('appearance').textContent).toBe('dark/mono'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/users/me/settings')).toBe(true));
    const patch = fetchMock.mock.calls.find(([url]) => url === '/api/users/me/settings');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ theme: 'light' });
    expect(screen.getByTestId('appearance').textContent).toBe('light/mono');
  });

  it('lands on Home when signing back in after an explicit sign-out', async () => {
    let signedIn = true;
    mockApi((url) => {
      if (url === '/api/auth/me') return signedIn ? json({ user: { ...USER, onboarded: true } }) : unauthenticated();
      if (url === '/api/auth/signout') {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/auth/signin') return json({ user: { ...USER, onboarded: true } });
      throw new Error(`unexpected ${url}`);
    });
    const router = renderApp('/settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long enough' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });

  it('tells a rate limit and a server error apart from a network failure, with a retry', async () => {
    mockApi(() => json({ error: { code: 'RATE_LIMITED', message: 'Slow down.' } }, 429));
    renderApp('/');
    expect((await screen.findByRole('alert')).textContent).toContain('Too many requests');
    vi.unstubAllGlobals();

    mockApi(() => json({ error: { code: 'INTERNAL', message: 'Oops.' } }, 500));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The server had a problem');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows a retry when the session check cannot reach the server', async () => {
    mockApi(() => Promise.reject(new TypeError('Failed to fetch')));
    renderApp('/');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('AuthScreen', () => {
  async function openAuth(route: Route) {
    mockApi((url, init) => (url === '/api/auth/me' ? unauthenticated() : route(url, init)));
    renderApp('/auth');
    await screen.findByRole('heading', { name: 'Sign in' });
  }

  it('validates before submitting and focuses the first invalid field', async () => {
    const route = vi.fn<Route>(() => json({}));
    await openAuth(route);
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const email = screen.getByLabelText('Email');
    expect((email).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(route).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Password')).getAttribute('autocomplete')).toBe('new-password');
  });

  it('shows the generic message on wrong credentials', async () => {
    await openAuth(() =>
      json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } }, 401),
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Email or password is incorrect.');
    expect((screen.getByLabelText('Password')).getAttribute('autocomplete')).toBe('current-password');
  });

  it('marks the email field when the email is taken and offers sign in instead', async () => {
    await openAuth(() => json({ error: { code: 'EMAIL_TAKEN', message: 'Taken.' } }, 409));
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long enough' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('reports a network failure and toggles password visibility', async () => {
    await openAuth(() => Promise.reject(new TypeError('Failed to fetch')));
    const password = screen.getByLabelText('Password');
    expect((password).getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((password).getAttribute('type')).toBe('text');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(password, { target: { value: 'long enough' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
  });
});
