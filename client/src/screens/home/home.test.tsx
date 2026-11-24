import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathItem, PathView, User } from '@rehearsal/shared';
import { AuthContext, type AuthContextValue } from '../../auth/authContext';
import { PathList } from '../../path/PathList';
import { HomeScreen } from './HomeScreen';

const mocks = vi.hoisted(() => ({ getPath: vi.fn() }));
vi.mock('../../path/pathApi', () => ({ getPath: mocks.getPath }));

function item(position: number, patch: Partial<PathItem> = {}): PathItem {
  return {
    position,
    scenarioId: `s${position}`,
    title: `Scenario ${position + 1}`,
    track: 'professional',
    difficulty: 1,
    state: 'locked',
    attemptCount: 0,
    canSkip: false,
    isCurrent: false,
    lastAttemptId: null,
    bestAttemptId: null,
    ...patch,
  };
}

function view(items: PathItem[], patch: Partial<PathView> = {}): PathView {
  const cleared = items.filter((i) => i.state === 'passed' || i.state === 'skipped').length;
  return {
    items,
    clearedCount: cleared,
    totalCount: items.length,
    complete: cleared === items.length,
    generatedAt: '2026-11-23T00:00:00.000Z',
    completedAt: null,
    ...patch,
  };
}

const USER: User = {
  id: 'u1',
  email: 'a@b.c',
  createdAt: '2026-11-23T00:00:00.000Z',
  profile: { goal: 'job-interview', goalDetail: '', timeframe: 'this-month', field: 'Law', confidence: 3 },
  settings: { theme: 'system', font: 'serif', showTranscript: true },
  onboarded: true,
};

function renderHome(updateUser = vi.fn()) {
  const auth: AuthContextValue = {
    status: 'signed-in',
    user: USER,
    sessionError: null,
    signedOutByUser: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    reload: vi.fn(),
    updateUser,
  };
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/onboarding" element={<p>Onboarding screen</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => mocks.getPath.mockReset());

describe('PathList (home)', () => {
  it('gives only actionable and skipped rows a link, with "Not yet" for a failed item', () => {
    const items = [
      item(0, { state: 'passed', attemptCount: 1 }),
      item(1, { state: 'skipped', attemptCount: 3 }),
      item(2, { state: 'failed', attemptCount: 1, isCurrent: true }),
      item(3),
    ];
    render(
      <MemoryRouter>
        <PathList items={items} variant="home" label="Path" />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).queryByRole('link')).toBeNull();
    expect(within(rows[0] as HTMLElement).getAllByText('Passed')).toHaveLength(1);
    expect(within(rows[1] as HTMLElement).getByRole('link').getAttribute('href')).toBe('/scenarios/s1/setup');
    const current = within(rows[2] as HTMLElement).getByRole('link');
    expect(current.getAttribute('aria-label')).toMatch(/Retry: Scenario 3, Professional, Not yet/);
    expect(within(rows[2] as HTMLElement).getAllByText('Not yet').length).toBeGreaterThan(0);
    expect(screen.queryByText(/fail/i)).toBeNull();
    expect(within(rows[3] as HTMLElement).queryByRole('link')).toBeNull();
  });
});

describe('HomeScreen', () => {
  it('shows a fresh path with "0 of 3" and a single Begin action', async () => {
    mocks.getPath.mockResolvedValue({ path: view([item(0, { state: 'available', isCurrent: true }), item(1), item(2)]) });
    renderHome();
    expect(await screen.findByLabelText('0 of 3 cleared')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /^Begin/ })).toHaveLength(1);
    expect(screen.getByText(/Start with Scenario 1/)).toBeTruthy();
    expect(screen.getByText('Preparing for a job or internship interview')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Explore the library/ }).getAttribute('href')).toBe('/explore');
    expect(screen.getByRole('link', { name: /Settings/ }).getAttribute('href')).toBe('/settings');
  });

  it('shows progress mid-path', async () => {
    mocks.getPath.mockResolvedValue({
      path: view([item(0, { state: 'passed', attemptCount: 2 }), item(1, { state: 'available', isCurrent: true }), item(2)]),
    });
    renderHome();
    expect(await screen.findByLabelText('1 of 3 cleared')).toBeTruthy();
    expect(screen.getByText('Up next: Scenario 2.')).toBeTruthy();
  });

  it('shows the completion summary and an Explore invitation', async () => {
    mocks.getPath.mockResolvedValue({
      path: view([item(0, { state: 'passed', attemptCount: 1 }), item(1, { state: 'skipped', attemptCount: 3 })]),
    });
    renderHome();
    expect(await screen.findByRole('heading', { name: 'You cleared all 2 scenarios.' })).toBeTruthy();
    expect(screen.getByText(/1 passed, 1 skipped/)).toBeTruthy();
  });

  it('sends a user without a path back to onboarding', async () => {
    mocks.getPath.mockResolvedValue({ path: null });
    const updateUser = vi.fn();
    renderHome(updateUser);
    expect(await screen.findByText('Onboarding screen')).toBeTruthy();
    expect(updateUser).toHaveBeenCalled();
  });

  it('offers a retry when loading fails', async () => {
    mocks.getPath.mockRejectedValueOnce(new Error('down'));
    renderHome();
    expect(await screen.findByText('Could not load your path')).toBeTruthy();
  });
});
