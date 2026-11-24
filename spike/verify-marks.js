// Verification for the waveform fix: does a real word array actually yield
// both mark arrays, and would drawStatic have anything to paint?
import 'dotenv/config';
import fs from 'node:fs';
import Groq, { toFile } from 'groq-sdk';
import { computeMetrics } from './metrics.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const buf = fs.readFileSync(new URL('./sampleA.wav', import.meta.url));

const r = await groq.audio.transcriptions.create({
  file: await toFile(buf, 'sampleA.wav', { type: 'audio/wav' }),
  model: 'whisper-large-v3-turbo',
  response_format: 'verbose_json',
  timestamp_granularities: ['word', 'segment'],
  language: 'en',
});

const m = computeMetrics(r.words);
console.log('transcript      :', JSON.stringify(r.text));
console.log('firstWordStart  :', m.firstWordStart);
console.log('definite (red)  :', m.fillerMarks.map((x) => `${x.word}@${x.start}`).join(' '));
console.log('ambiguous(amber):', m.ambiguousMarks.map((x) => `${x.word}@${x.start}`).join(' '));
console.log('pauses >2s      :', m.pauseCount2s);

// The old drawStatic read only fillerMarks + pauseMarks.
const before = m.fillerMarks.length + m.pauseCount2s;
const after = before + m.ambiguousMarks.length;
console.log(`\nmarks painted BEFORE fix: ${before}`);
console.log(`marks painted AFTER  fix: ${after}`);

// Simulate the reported case: the user's take where only "basically" survived.
const onlyBasically = [
  { word: 'I', start: 0.0, end: 0.2 },
  { word: 'basically', start: 0.2, end: 0.8 },
  { word: 'built', start: 0.8, end: 1.1 },
  { word: 'this', start: 1.1, end: 1.3 },
  { word: 'thing', start: 1.3, end: 1.6 },
];
const u = computeMetrics(onlyBasically);
console.log('\n--- reported Sample A case (only "basically" survived) ---');
console.log('definite (red)  :', u.fillerMarks.length, '<- nothing to paint, correctly');
console.log('ambiguous(amber):', u.ambiguousMarks.length, '<- was dropped on the floor before the fix');
