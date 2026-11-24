// Level did not break it. Test SNR instead: quiet speech in a room with
// background noise is the real-world case, not clean speech turned down.
import 'dotenv/config';
import fs from 'node:fs';
import Groq, { toFile } from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const src = fs.readFileSync(new URL('./sampleA.wav', import.meta.url));

function dataOffset(b) {
  let o = 12;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'data') return { start: o + 8, size };
    o += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function signalRms(b) {
  const { start, size } = dataOffset(b);
  let sum = 0, n = 0;
  for (let i = start; i + 1 < start + size; i += 2) {
    const s = b.readInt16LE(i) / 32768;
    sum += s * s; n += 1;
  }
  return Math.sqrt(sum / n);
}

// Mix in white noise at a target SNR in dB.
function withNoise(snrDb) {
  const out = Buffer.from(src);
  const { start, size } = dataOffset(out);
  const noiseRms = signalRms(src) / 10 ** (snrDb / 20);
  for (let i = start; i + 1 < start + size; i += 2) {
    // Box-Muller-ish: sum of uniforms is close enough to gaussian here.
    const n = ((Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2) * noiseRms * 32768;
    const v = out.readInt16LE(i) + n;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i);
  }
  return out;
}

const FILLERS = ['um', 'uh', 'er', 'like', 'you', 'know', 'mean', 'so', 'basically'];

for (const snr of [30, 20, 15, 10, 5]) {
  const buf = withNoise(snr);
  const file = await toFile(buf, 'q.wav', { type: 'audio/wav' });
  const r = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    language: 'en',
  });
  const words = (r.words || []).map((w) => w.word.toLowerCase().replace(/[^a-z']/g, ''));
  const seg = (r.segments || [])[0] || {};
  console.log(`\n=== SNR ${snr} dB ===`);
  console.log('text        :', JSON.stringify(r.text));
  console.log('fillersKept :', FILLERS.filter((f) => words.includes(f)).join(', ') || '(NONE)');
  console.log('seg quality : avg_logprob=%s no_speech_prob=%s compression=%s',
    seg.avg_logprob, seg.no_speech_prob, seg.compression_ratio);
}
