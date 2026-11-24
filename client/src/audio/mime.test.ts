import { describe, expect, it } from 'vitest';
import { baseMimeType, pickRecorderMimeType, RECORDER_MIME_CANDIDATES } from './mime';

describe('pickRecorderMimeType', () => {
  it('prefers webm/opus when supported (Chrome, Firefox)', () => {
    expect(pickRecorderMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to mp4 when webm is unsupported (Safari)', () => {
    const safari = (type: string) => type.startsWith('audio/mp4');
    expect(pickRecorderMimeType(safari)).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('returns null when nothing is supported so the browser default is used', () => {
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });

  it('treats a throwing support check as unsupported and keeps looking', () => {
    const picky = (type: string) => {
      if (type.includes('codecs')) throw new Error('bad parameter');
      return type === 'audio/mp4';
    };
    expect(pickRecorderMimeType(picky)).toBe('audio/mp4');
  });

  it('lists webm before mp4', () => {
    const list: readonly string[] = RECORDER_MIME_CANDIDATES;
    expect(list.indexOf('audio/webm')).toBeLessThan(list.indexOf('audio/mp4'));
  });
});

describe('baseMimeType', () => {
  it('drops codec parameters', () => {
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMimeType('audio/mp4')).toBe('audio/mp4');
  });
});
