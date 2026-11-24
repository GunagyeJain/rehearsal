// Throwaway evidence-gathering for the "does Whisper keep fillers" unknown.
// Runs the same audio through every combination we can control.
import 'dotenv/config';
import fs from 'node:fs';
import Groq, { toFile } from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const buf = fs.readFileSync(new URL('./sampleA.wav', import.meta.url));

const VERBATIM_PROMPT =
  'Transcribe verbatim, including every filler word and hesitation exactly as spoken: um, uh, er, hmm, like, you know.';

const configs = [
  { name: 'turbo / no prompt', model: 'whisper-large-v3-turbo' },
  { name: 'turbo / verbatim prompt', model: 'whisper-large-v3-turbo', prompt: VERBATIM_PROMPT },
  { name: 'turbo / verbatim + temp 0', model: 'whisper-large-v3-turbo', prompt: VERBATIM_PROMPT, temperature: 0 },
  { name: 'large-v3 / no prompt', model: 'whisper-large-v3' },
  { name: 'large-v3 / verbatim prompt', model: 'whisper-large-v3', prompt: VERBATIM_PROMPT },
  { name: 'large-v3 / verbatim + temp 0', model: 'whisper-large-v3', prompt: VERBATIM_PROMPT, temperature: 0 },
];

const FILLERS = ['um', 'uh', 'er', 'like', 'you', 'know', 'mean', 'so', 'basically'];

for (const cfg of configs) {
  const file = await toFile(buf, 'sampleA.wav', { type: 'audio/wav' });
  const params = {
    file,
    model: cfg.model,
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    language: 'en',
  };
  if (cfg.prompt) params.prompt = cfg.prompt;
  if (cfg.temperature !== undefined) params.temperature = cfg.temperature;

  try {
    const r = await groq.audio.transcriptions.create(params);
    const words = (r.words || []).map((w) => w.word.toLowerCase().replace(/[^a-z']/g, ''));
    const kept = FILLERS.filter((f) => words.includes(f));
    const seg = (r.segments || [])[0] || {};
    console.log(`\n=== ${cfg.name} ===`);
    console.log('text        :', JSON.stringify(r.text));
    console.log('wordCount   :', words.length);
    console.log('fillersKept :', kept.join(', ') || '(NONE)');
    console.log('seg quality : avg_logprob=%s no_speech_prob=%s compression=%s',
      seg.avg_logprob, seg.no_speech_prob, seg.compression_ratio);
  } catch (e) {
    console.log(`\n=== ${cfg.name} ===\nERROR ${e.status}: ${e.message}`);
  }
}
