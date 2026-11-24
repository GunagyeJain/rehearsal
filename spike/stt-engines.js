// STT engines under comparison, normalised to one shape. Throwaway spike code.
//
// Every engine here MUST return word-level timestamps. That is not a
// preference: spec/phase-0-spike.md and CLAUDE.md both state that without word
// timestamps a scenario cannot be scored at all. An engine that cannot do it is
// disqualified regardless of accuracy - which is why OpenAI's newer
// gpt-transcribe / gpt-4o-mini-transcribe models are absent. OpenAI documents
// timestamp_granularities[] as supported ONLY on whisper-1.
//
// No SDKs: plain fetch against each REST API, so comparing one more provider
// costs a function, not a dependency.

import Groq, { toFile } from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const norm = (w) => ({ word: w.word, start: w.start, end: w.end });

async function groqWhisper(model, buffer, filename, mimetype) {
  const r = await groq.audio.transcriptions.create({
    file: await toFile(buffer, filename, { type: mimetype }),
    model,
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    language: 'en',
  });
  const segs = r.segments || [];
  const lp = segs.map((s) => s.avg_logprob).filter((n) => typeof n === 'number');
  return {
    transcript: r.text,
    words: (r.words || []).map(norm),
    confidence: lp.length ? +(lp.reduce((a, b) => a + b, 0) / lp.length).toFixed(3) : null,
    confidenceScale: 'avg_logprob (0 best, below -0.6 unreliable)',
  };
}

// OpenAI hosted Whisper. whisper-1 is Whisper large-v2 and is the ONLY OpenAI
// model that returns word timestamps.
async function openaiWhisper(buffer, filename, mimetype) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);

  const r = await res.json();
  const segs = r.segments || [];
  const lp = segs.map((s) => s.avg_logprob).filter((n) => typeof n === 'number');
  return {
    transcript: r.text,
    words: (r.words || []).map(norm),
    confidence: lp.length ? +(lp.reduce((a, b) => a + b, 0) / lp.length).toFixed(3) : null,
    confidenceScale: 'avg_logprob (0 best, below -0.6 unreliable)',
  };
}

// Deepgram Nova-3. The only provider found with an explicit switch for keeping
// disfluencies: filler_words=true. Everything else strips "um"/"uh" by default
// to make transcripts read nicely, which is precisely the behaviour that breaks
// this product.
async function deepgramNova(buffer, mimetype) {
  const qs = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    filler_words: 'true',
    punctuate: 'true',
    smart_format: 'false', // smart_format rewrites disfluencies away again
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': mimetype },
    body: buffer,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);

  const r = await res.json();
  const alt = r.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw new Error('No alternatives in Deepgram response.');
  return {
    transcript: alt.transcript,
    words: (alt.words || []).map((w) => ({ word: w.punctuated_word || w.word, start: w.start, end: w.end })),
    confidence: typeof alt.confidence === 'number' ? +alt.confidence.toFixed(3) : null,
    confidenceScale: 'confidence (1 best)',
  };
}

export const ENGINES = [
  {
    id: 'groq-whisper-large-v3-turbo',
    label: 'Groq whisper-large-v3-turbo (current)',
    envKey: 'GROQ_API_KEY',
    run: (b, f, m) => groqWhisper('whisper-large-v3-turbo', b, f, m),
  },
  {
    id: 'groq-whisper-large-v3',
    label: 'Groq whisper-large-v3',
    envKey: 'GROQ_API_KEY',
    run: (b, f, m) => groqWhisper('whisper-large-v3', b, f, m),
  },
  {
    id: 'openai-whisper-1',
    label: 'OpenAI whisper-1 (large-v2)',
    envKey: 'OPENAI_API_KEY',
    run: (b, f, m) => openaiWhisper(b, f, m),
  },
  {
    id: 'deepgram-nova-3',
    label: 'Deepgram Nova-3 (filler_words=true)',
    envKey: 'DEEPGRAM_API_KEY',
    run: (b, f, m) => deepgramNova(b, m),
  },
];

export const availableEngines = () =>
  ENGINES.map((e) => ({ ...e, available: Boolean(process.env[e.envKey]) }));
