/**
 * Browser speech *synthesis* fallback for the AI's line when /api/tts is unavailable (the Groq
 * quota is small). Speech *recognition* is never used: all transcription is server-side Whisper.
 */

/** Extra time allowed past the estimated length before giving up on an `end` event that never fires. */
const WATCHDOG_GRACE_MS = 4000;
const WATCHDOG_FACTOR = 2;

export function canSynthesizeSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

export interface SynthesisOptions {
  signal?: AbortSignal;
  /** Expected spoken length; bounds the wait when a browser never fires `end`. */
  expectedSec: number;
  lang?: string;
}

/**
 * Speak a line and resolve when it ends. Rejects when synthesis is unsupported or errors, and with
 * an AbortError when the signal aborts (speech is cancelled at once).
 */
export function speakWithSynthesis(text: string, options: SynthesisOptions): Promise<void> {
  const { signal, expectedSec, lang = 'en-US' } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('Speech aborted', 'AbortError'));
  if (!canSynthesizeSpeech()) return Promise.reject(new Error('Speech synthesis is not supported.'));
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const watchdog = window.setTimeout(
      () => finish(() => resolve()),
      Math.max(expectedSec, 1) * 1000 * WATCHDOG_FACTOR + WATCHDOG_GRACE_MS,
    );
    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      signal?.removeEventListener('abort', onAbort);
      settle();
    }
    function onAbort(): void {
      synth.cancel();
      finish(() => reject(new DOMException('Speech aborted', 'AbortError')));
    }
    utterance.onend = () => finish(() => resolve());
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      // 'interrupted' / 'canceled' follow our own cancel(); the abort handler already settled.
      finish(() => reject(new Error(`Speech synthesis failed (${event.error}).`)));
    };
    signal?.addEventListener('abort', onAbort);
    synth.cancel();
    synth.speak(utterance);
  });
}
