import { describe, expect, it } from 'vitest';
import { bucketRms, mixToMono, normalisePeaks, peaksFromChannels, peaksFromWords, resamplePeaks } from './peaks';

describe('bucketRms', () => {
  it('splits samples into equal buckets', () => {
    expect(bucketRms([1, -1, 0, 0, 0.5, -0.5], 3)).toEqual([1, 0, 0.5]);
  });

  it('handles more buckets than samples without empty spans', () => {
    const out = bucketRms([1, 0], 4);
    expect(out).toHaveLength(4);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('returns zeros for empty input and nothing for zero buckets', () => {
    expect(bucketRms([], 3)).toEqual([0, 0, 0]);
    expect(bucketRms([1, 1], 0)).toEqual([]);
  });
});

describe('normalisePeaks', () => {
  it('maps the reference percentile to 1 and clamps spikes', () => {
    const values = [...Array.from({ length: 99 }, () => 0.2), 5];
    const out = normalisePeaks(values);
    expect(out[0]).toBeCloseTo(1);
    expect(out[99]).toBe(1);
  });

  it('keeps silence silent', () => {
    expect(normalisePeaks([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('resamplePeaks', () => {
  it('keeps the max of each span when downsampling so short sounds survive', () => {
    expect(resamplePeaks([0, 0.9, 0, 0, 0.1, 0], 2)).toEqual([0.9, 0.1]);
  });

  it('repeats values when upsampling', () => {
    expect(resamplePeaks([0.2, 0.8], 4)).toEqual([0.2, 0.2, 0.8, 0.8]);
  });

  it('returns zeros for no data', () => {
    expect(resamplePeaks([], 3)).toEqual([0, 0, 0]);
  });
});

describe('mixToMono and peaksFromChannels', () => {
  it('averages channels', () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
  });

  it('produces normalised buckets', () => {
    const left = new Float32Array([0.1, -0.1, 0.4, -0.4]);
    const out = peaksFromChannels([left], 2);
    expect(out[1]).toBe(1);
    expect(out[0]).toBeCloseTo(0.25);
  });
});

describe('peaksFromWords', () => {
  it('raises bars inside word spans only', () => {
    const out = peaksFromWords([{ word: 'hello', start: 0, end: 1 }], 4, 4);
    expect(out[0]).toBeGreaterThan(0.4);
    expect(out.slice(1)).toEqual([0, 0, 0]);
  });

  it('is deterministic', () => {
    const words = [{ word: 'a', start: 0.5, end: 1.5 }];
    expect(peaksFromWords(words, 3, 30)).toEqual(peaksFromWords(words, 3, 30));
  });
});
