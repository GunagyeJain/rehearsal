import { describe, expect, it } from 'vitest';
import { wavDurationSec } from './wav';

function writeTag(view: DataView, offset: number, tag: string) {
  for (let i = 0; i < 4; i += 1) view.setUint8(offset + i, tag.charCodeAt(i));
}

function makeWav(dataBytes: number, byteRate: number, declaredSize = dataBytes): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeTag(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(view, 8, 'WAVE');
  writeTag(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, byteRate / 2, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(view, 36, 'data');
  view.setUint32(40, declaredSize, true);
  return buffer;
}

describe('wavDurationSec', () => {
  it('reads the duration from the data chunk and byte rate', () => {
    expect(wavDurationSec(makeWav(48000, 48000))).toBeCloseTo(1);
  });

  it('measures to the end of the buffer when the size is a streaming placeholder', () => {
    expect(wavDurationSec(makeWav(24000, 48000, 0xffffffff))).toBeCloseTo(0.5);
  });

  it('returns null for something that is not a WAV', () => {
    expect(wavDurationSec(new ArrayBuffer(64))).toBeNull();
    expect(wavDurationSec(new ArrayBuffer(4))).toBeNull();
  });
});
