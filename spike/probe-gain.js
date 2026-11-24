// Does input level alone explain the dropped fillers? Attenuate the same clean
// WAV and re-transcribe. 16-bit PCM only - that is what SAPI writes.
import 'dotenv/config';
import fs from 'node:fs';
import Groq, { toFile } from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const src = fs.readFileSync(new URL('./sampleA.wav', import.meta.url));

// Locate the data chunk rather than assuming a 44-byte header.
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

function scaled(gain) {
  const out = Buffer.from(src);
  const { start, size } = dataOffset(out);
  for (let i = start; i + 1 < start + size; i += 2) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out.readInt16LE(i) * gain))), i);
  }
  return out;
}

function rmsDbfs(b) {
  const { start, size } = dataOffset(b);
  let sum = 0, n = 0;
  for (let i = start; i + 1 < start + size; i += 2) {
    const s = b.readInt16LE(i) / 32768;
    sum += s * s; n += 1;
  }
  return 20 * Math.log10(Math.sqrt(sum / n));
}

const FILLERS = ['um', 'uh', 'er', 'like', 'you', 'know', 'mean', 'so', 'basically'];

for (const gain of [1, 0.25, 0.1, 0.05, 0.02]) {
  const buf = scaled(gain);
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
  console.log(`\n=== gain x${gain}  (RMS ${rmsDbfs(buf).toFixed(1)} dBFS) ===`);
  console.log('text        :', JSON.stringify(r.text));
  console.log('fillersKept :', FILLERS.filter((f) => words.includes(f)).join(', ') || '(NONE)');
  console.log('seg quality : avg_logprob=%s no_speech_prob=%s', seg.avg_logprob, seg.no_speech_prob);
}
