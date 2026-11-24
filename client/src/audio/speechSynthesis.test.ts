import { afterEach, describe, expect, it, vi } from 'vitest';
import { canSynthesizeSpeech, speakWithSynthesis } from './speechSynthesis';

class FakeUtterance {
  text: string;
  lang = '';
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installSynth(behaviour: 'end' | 'error' | 'silent') {
  const spoken: FakeUtterance[] = [];
  const synth = {
    cancel: vi.fn(),
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      if (behaviour === 'end') queueMicrotask(() => u.onend?.());
      if (behaviour === 'error') queueMicrotask(() => u.onerror?.({ error: 'synthesis-failed' }));
    }),
  };
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  return { synth, spoken };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'speechSynthesis');
});

describe('speakWithSynthesis', () => {
  it('reports unsupported browsers and rejects', async () => {
    expect(canSynthesizeSpeech()).toBe(false);
    await expect(speakWithSynthesis('Hello.', { expectedSec: 1 })).rejects.toThrow('not supported');
  });

  it('speaks the line and resolves when it ends', async () => {
    const { spoken } = installSynth('end');
    expect(canSynthesizeSpeech()).toBe(true);
    await expect(speakWithSynthesis('Tell me about yourself.', { expectedSec: 2 })).resolves.toBeUndefined();
    expect(spoken[0]?.text).toBe('Tell me about yourself.');
  });

  it('rejects when synthesis errors', async () => {
    installSynth('error');
    await expect(speakWithSynthesis('Hello.', { expectedSec: 1 })).rejects.toThrow('synthesis-failed');
  });

  it('cancels speech and rejects with AbortError on abort', async () => {
    const { synth } = installSynth('silent');
    const controller = new AbortController();
    const promise = speakWithSynthesis('Hello.', { expectedSec: 1, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('resolves via the watchdog when the browser never fires end', async () => {
    vi.useFakeTimers();
    installSynth('silent');
    const promise = speakWithSynthesis('Hello.', { expectedSec: 1 });
    vi.advanceTimersByTime(10_000);
    await expect(promise).resolves.toBeUndefined();
  });
});
