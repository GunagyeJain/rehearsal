import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_STORAGE_KEY } from './appearance';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './themeContext';

function Probe() {
  const { theme, font, resolvedTheme, setTheme, setFont } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${theme}/${font}/${resolvedTheme}`}</p>
      <button type="button" onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button type="button" onClick={() => setFont('mono')}>
        Mono
      </button>
    </div>
  );
}

const html = () => document.documentElement;

describe('ThemeProvider', () => {
  it('applies the default appearance to <html> on mount', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(html().dataset.theme).toBe('system');
    expect(html().dataset.font).toBe('serif');
    expect(screen.getByTestId('state').textContent).toBe('system/serif/light');
  });

  it('updates data-theme and data-font and persists them', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Dark' }).click());
    act(() => screen.getByRole('button', { name: 'Mono' }).click());

    expect(html().dataset.theme).toBe('dark');
    expect(html().dataset.font).toBe('mono');
    expect(html().dataset.resolvedTheme).toBe('dark');
    expect(JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}')).toEqual({
      theme: 'dark',
      font: 'mono',
    });
  });

  it('restores stored appearance and ignores invalid values', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'dark', font: 'comic' }));

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(html().dataset.theme).toBe('dark');
    expect(html().dataset.font).toBe('serif');
  });

  it('syncs meta theme-color from the active --bg token', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = 'initial';
    document.head.appendChild(meta);
    html().style.setProperty('--bg', 'rgb(1, 2, 3)');

    render(
      <ThemeProvider initial={{ theme: 'light' }}>
        <Probe />
      </ThemeProvider>,
    );

    expect(meta.content).toBe('rgb(1, 2, 3)');
    html().style.removeProperty('--bg');
    meta.remove();
  });
});
