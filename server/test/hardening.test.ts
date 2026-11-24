import { describe, expect, it } from 'vitest';
import { normalizeAudioMime } from '../src/middleware/audioUpload';
import { safeErrorLabel } from '../src/http/safeErrorLabel';
import { mediaDurationSec } from '../src/routes/answers';

describe('normalizeAudioMime', () => {
  it('collapses codec parameters and aliases to one stored value', () => {
    expect(normalizeAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMime('AUDIO/X-WAV')).toBe('audio/wav');
    expect(normalizeAudioMime('audio/x-m4a')).toBe('audio/mp4');
  });

  it('rejects types the recorder never produces', () => {
    expect(normalizeAudioMime('audio/x-evil')).toBeNull();
    expect(normalizeAudioMime('text/html')).toBeNull();
  });
});

describe('safeErrorLabel', () => {
  it('never includes the message, which can embed transcript values', () => {
    const error = Object.assign(new Error('Cast to string failed for value "my secret answer"'), { name: 'CastError' });
    expect(safeErrorLabel(error)).toBe('CastError');
  });

  it('keeps numeric status and duplicate-key codes', () => {
    const error = Object.assign(new Error('E11000 dup key: { transcript: "x" }'), { name: 'MongoServerError', code: 11000 });
    expect(safeErrorLabel(error)).toBe('MongoServerError code 11000');
    expect(safeErrorLabel(Object.assign(new Error('x'), { status: 429 }))).toBe('Error status 429');
  });
});

describe('mediaDurationSec', () => {
  it('keeps the client length when Groq stops at the last word', () => {
    expect(mediaDurationSec(1.92, 22.4)).toBe(22.4);
  });

  it('keeps the transcribed length when it is the longer one', () => {
    expect(mediaDurationSec(30.5, 30.1)).toBe(30.5);
  });

  it('falls back to whichever figure is usable', () => {
    expect(mediaDurationSec(Number.NaN, 12)).toBe(12);
    expect(mediaDurationSec(8, 0)).toBe(8);
  });
});
