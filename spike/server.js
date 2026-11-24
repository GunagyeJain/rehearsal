// Phase 0 spike server. Throwaway.
// Spike 1+2: Groq Whisper word timestamps -> metrics
// Spike 3:   Groq TTS availability + latency
// Spike 4:   Claude verdict latency + stability

import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { computeMetrics } from './metrics.js';
import { availableEngines } from './stt-engines.js';
import { scoreAgainstReference } from './wer.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

// ---------------------------------------------------------------- Spike 3a
// Which Groq models actually exist today? spec/phase-0-spike.md says verify
// canopylabs/orpheus-v1-english rather than assuming it.
app.get('/api/models', async (_req, res) => {
  try {
    const list = await groq.models.list();
    const ids = list.data.map((m) => m.id).sort();
    res.json({
      total: ids.length,
      whisper: ids.filter((id) => /whisper/i.test(id)),
      tts: ids.filter((id) => /tts|orpheus|speech|playai|canopy/i.test(id)),
      all: ids,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.status });
  }
});

// ------------------------------------------------------------- Spike 1 + 2
// verbatim=1 adds the prompt-bias attempt from spec/phase-0-spike.md.
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded.' });

  const verbatim = req.query.verbatim === '1';
  const model = req.query.model || 'whisper-large-v3-turbo';
  const t0 = process.hrtime.bigint();

  try {
    const file = await toFile(req.file.buffer, `answer.${req.query.ext || 'webm'}`, {
      type: req.file.mimetype,
    });

    const params = {
      file,
      model,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      language: 'en',
    };
    // The single highest-risk unknown: does Whisper keep "um" and "uh"?
    if (verbatim) {
      params.prompt =
        'Transcribe verbatim, including every filler word and hesitation exactly as spoken: um, uh, er, hmm, like, you know.';
    }

    const result = await groq.audio.transcriptions.create(params);
    const latencyMs = ms(t0);

    const words = result.words || [];

    // We already ask for segments and have been discarding them. avg_logprob
    // and no_speech_prob are Whisper telling us how much it trusts itself -
    // the only signal available for "this transcript is not scoreable".
    const segments = result.segments || [];
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const logprobs = segments.map((s) => s.avg_logprob).filter((n) => typeof n === 'number');
    const meanLogprob = avg(logprobs);
    const confidence = {
      meanAvgLogprob: meanLogprob === null ? null : +meanLogprob.toFixed(3),
      worstAvgLogprob: logprobs.length ? +Math.min(...logprobs).toFixed(3) : null,
      maxNoSpeechProb: segments.length
        ? +Math.max(...segments.map((s) => s.no_speech_prob ?? 0)).toFixed(3)
        : null,
      maxCompressionRatio: segments.length
        ? +Math.max(...segments.map((s) => s.compression_ratio ?? 0)).toFixed(2)
        : null,
      // Clean speech measures about -0.06 to -0.12 (see probe-fillers.js).
      // Below -0.6 the transcript is guesswork and must not be scored.
      reliable: meanLogprob === null ? null : meanLogprob > -0.6,
      perSegment: segments.map((s) => ({
        start: s.start,
        end: s.end,
        avgLogprob: s.avg_logprob,
        noSpeechProb: s.no_speech_prob,
        text: s.text,
      })),
    };

    let metrics = null;
    let metricsError = null;
    try {
      metrics = computeMetrics(words);
    } catch (e) {
      metricsError = e.message; // fail loudly, per spec/scoring.md
    }

    res.json({
      diagnostics: {
        latencyMs,
        model,
        verbatimPrompt: verbatim,
        receivedMimeType: req.file.mimetype,
        receivedBytes: req.file.size,
        wordCount: words.length,
        wordTimestampsPresent: words.length > 0,
        sampleWords: words.slice(0, 12),
        hasSegments: Array.isArray(result.segments),
      },
      transcript: result.text,
      confidence,
      words,
      metrics,
      metricsError,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.status, latencyMs: ms(t0) });
  }
});

// ---------------------------------------------------------------- preflight
// "Is the key present" and "is the key valid" are BOTH weaker questions than
// "does this actually work". A key can authenticate perfectly and still fail
// every real request because the account has no credits - which is exactly the
// state the OpenAI key was found in: GET /v1/models returns 200, transcription
// returns 429. So the preflight makes a real, minimal, billable call against
// each provider rather than an auth ping.

// 0.4s of a quiet tone at 16kHz, built in memory. Cheapest possible real
// request: no file on disk, and a fraction of a second of billed audio.
function tinyWav(seconds = 0.4, rate = 16000) {
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 2000), 44 + i * 2);
  }
  return buf;
}

// Turns a provider failure into something a human can act on.
function classify(status, body) {
  const text = String(body).toLowerCase();
  if (status === 401 || status === 403) {
    return { status: 'invalid', detail: `key rejected (HTTP ${status}) - wrong, expired, or revoked` };
  }
  if (status === 429 && /credit|quota|billing|insufficient|exceeded/.test(text)) {
    return { status: 'no credits', detail: 'key is VALID but the account has no credits or quota left - add billing' };
  }
  if (status === 429) return { status: 'rate limited', detail: 'key valid, too many requests right now - retry shortly' };
  return { status: 'error', detail: `HTTP ${status} - ${String(body).slice(0, 160)}` };
}

async function verifyProvider({ id, label, envVar, note, call }) {
  const key = process.env[envVar];
  if (!key) {
    return { id, label, envVar, note, status: 'missing', ok: false, detail: `${envVar} not set in spike/.env` };
  }
  try {
    await call(key);
    return { id, label, envVar, note, status: 'working', ok: true, detail: 'a real request succeeded' };
  } catch (err) {
    const httpStatus = err.status ?? err.httpStatus ?? null;
    const c = classify(httpStatus, err.body ?? err.message ?? '');
    return { id, label, envVar, note, ok: false, ...c };
  }
}

// fetch() does not throw on 4xx, so failures are normalised into throws that
// carry the status and body classify() needs.
async function post(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    e.body = await res.text();
    throw e;
  }
  return res;
}

app.get('/api/preflight', async (_req, res) => {
  const wav = tinyWav();

  const checks = await Promise.all([
    verifyProvider({
      id: 'groq', label: 'Groq (STT + TTS)', envVar: 'GROQ_API_KEY',
      note: 'required - transcription and text to speech both run on Groq',
      call: async () => {
        await groq.audio.transcriptions.create({
          file: await toFile(wav, 'preflight.wav', { type: 'audio/wav' }),
          model: 'whisper-large-v3-turbo',
          response_format: 'json',
          language: 'en',
        });
      },
    }),
    verifyProvider({
      id: 'anthropic', label: 'Anthropic (judge)', envVar: 'ANTHROPIC_API_KEY',
      note: 'required - scores the rubric',
      call: async () => {
        await anthropic.messages.create({
          model: 'claude-opus-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
      },
    }),
    verifyProvider({
      id: 'openai', label: 'OpenAI whisper-1', envVar: 'OPENAI_API_KEY',
      note: 'optional - whisper-1 is the ONLY OpenAI model returning word '
        + 'timestamps, and it is Whisper large-v2, older than the large-v3 Groq runs',
      call: async (k) => {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'preflight.wav');
        form.append('model', 'whisper-1');
        form.append('response_format', 'json');
        await post('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${k}` }, body: form,
        });
      },
    }),
    verifyProvider({
      id: 'deepgram', label: 'Deepgram Nova-3', envVar: 'DEEPGRAM_API_KEY',
      note: 'optional - the only engine with an explicit filler_words switch',
      call: async (k) => {
        await post('https://api.deepgram.com/v1/listen?model=nova-3&language=en', {
          method: 'POST',
          headers: { Authorization: `Token ${k}`, 'Content-Type': 'audio/wav' },
          body: wav,
        });
      },
    }),
  ]);

  res.json({
    verifiedWith: 'a real 0.4s request per provider, not an auth ping',
    checks,
    requiredOk: checks.filter((c) => /^required/.test(c.note)).every((c) => c.ok),
    sttEnginesWorking: checks.filter((c) => c.ok && ['groq', 'openai', 'deepgram'].includes(c.id)).length,
  });
});

// ------------------------------------------------------- Spike 1b: STT bake-off
// One recording, every engine, same audio. Ranked on what this product needs:
// word timestamps (a hard gate), filler retention, then content accuracy.
app.get('/api/stt-engines', (_req, res) =>
  res.json(availableEngines().map(({ id, label, envKey, available }) => ({ id, label, envKey, available }))),
);

app.post('/api/stt-compare', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded.' });

  const reference = req.body?.reference || '';
  const filename = `answer.${req.body?.ext || 'webm'}`;
  const engines = availableEngines().filter((e) => e.available);
  if (engines.length === 0) {
    return res.status(400).json({ error: 'No STT engine has an API key configured.' });
  }

  const settled = await Promise.allSettled(
    engines.map(async (e) => {
      const t0 = process.hrtime.bigint();
      const out = await e.run(req.file.buffer, filename, req.file.mimetype);
      return { engine: e, latencyMs: ms(t0), ...out };
    }),
  );

  const results = settled.map((s, i) => {
    const e = engines[i];
    if (s.status === 'rejected') {
      return { id: e.id, label: e.label, error: s.reason.message, usable: false };
    }
    const { words, transcript, latencyMs, confidence, confidenceScale } = s.value;

    // The hard gate. No word timestamps, no scoring - so an engine that fails
    // this is out no matter how good the transcript reads.
    let metrics = null;
    let metricsError = null;
    try {
      metrics = computeMetrics(words);
    } catch (err) {
      metricsError = err.message;
    }

    return {
      id: e.id,
      label: e.label,
      latencyMs,
      transcript,
      wordCount: words.length,
      wordTimestamps: words.length > 0 && words.every((w) => typeof w.start === 'number'),
      confidence,
      confidenceScale,
      fillerCount: metrics?.fillerCount ?? null,
      ambiguousCount: metrics?.ambiguousCount ?? null,
      fillerMarks: metrics?.fillerMarks ?? [],
      wpm: metrics?.wpm ?? null,
      accuracy: reference ? scoreAgainstReference(reference, transcript) : null,
      metricsError,
      usable: Boolean(metrics),
      words,
    };
  });

  // Verbatim WER is the ranking key: it penalises both a misheard word and a
  // silently dropped filler, which are the two failures actually observed.
  const ranked = [...results]
    .filter((r) => r.usable && r.accuracy)
    .sort((a, b) => a.accuracy.verbatimWer - b.accuracy.verbatimWer);

  res.json({
    reference: reference || null,
    receivedBytes: req.file.size,
    receivedMimeType: req.file.mimetype,
    summary: results.map((r) => ({
      engine: r.label,
      latencyMs: r.latencyMs ?? null,
      wordTimestamps: r.wordTimestamps ?? false,
      fillersFound: r.fillerCount,
      verbatimWer: r.accuracy?.verbatimWer ?? null,
      contentWer: r.accuracy?.contentWer ?? null,
      fillerRetention: r.accuracy?.fillerRetention ?? null,
      error: r.error ?? r.metricsError ?? null,
    })),
    winnerByVerbatimWer: ranked[0]?.label ?? null,
    results,
  });
});

// ---------------------------------------------------------------- Spike 3b
app.post('/api/tts', async (req, res) => {
  // Groq rejects capitalised voice names. 'Autumn' returns a 400 that reads
  // like an entitlement problem, which is how it got logged as a terms-
  // acceptance blocker in spec/phase-0-spike.md. Valid: autumn diana hannah
  // austin daniel troy.
  const { text, model = 'canopylabs/orpheus-v1-english', voice = 'autumn' } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text.' });

  const t0 = process.hrtime.bigint();
  try {
    const response = await groq.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: 'wav',
    });
    const headersMs = ms(t0);

    // Measure first byte separately from full body to see if streaming is real.
    let firstByteMs = null;
    const chunks = [];
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstByteMs === null) firstByteMs = ms(t0);
        chunks.push(Buffer.from(value));
      }
    } else {
      chunks.push(Buffer.from(await response.arrayBuffer()));
      firstByteMs = ms(t0);
    }
    const buffer = Buffer.concat(chunks);
    const completeMs = ms(t0);

    res.set({
      'Content-Type': 'audio/wav',
      'X-Model': model,
      'X-Headers-Ms': String(headersMs),
      'X-First-Byte-Ms': String(firstByteMs),
      'X-Complete-Ms': String(completeMs),
      'X-Bytes': String(buffer.length),
      'X-Chunks': String(chunks.length),
    });
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.status, model, latencyMs: ms(t0) });
  }
});

// ----------------------------------------------------------------- Spike 4
// spec/scoring.md asks for temperature: 0. That parameter is REMOVED on
// claude-opus-5 and returns a 400, so stability has to come from the prompt
// and a strict output schema instead. That is exactly what this measures.
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    structurePass: { type: 'boolean' },
    evidence: { type: 'string' },
    nextAction: { type: 'string' },
    fillerRulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          index: { type: 'integer' },
          isFiller: { type: 'boolean' },
        },
        required: ['word', 'index', 'isFiller'],
        additionalProperties: false,
      },
    },
  },
  required: ['structurePass', 'evidence', 'nextAction', 'fillerRulings'],
  additionalProperties: false,
};

const FIXTURE = {
  criterion:
    'The introduction covers, in order: who they are, what they do, one specific concrete detail (a project, a result, an interest), and closes cleanly rather than trailing off.',
  transcript:
    "So, um, hi, I'm Priya and I'm a final year computer engineering student at Thapar. I've basically been working on, like, a scheduling tool for our department that cut timetable clashes by about forty percent, and, uh, I built the solver in Python. I mean, I'm really interested in systems work and, you know, that's kind of what I want to do next. Yeah, so that's me I guess.",
  ambiguous: [
    { word: 'so', index: 0 },
    { word: 'basically', index: 24 },
    { word: 'like', index: 27 },
    { word: 'i mean', index: 52 },
    { word: 'you know', index: 60 },
    { word: 'kind of', index: 63 },
  ],
  metrics: { wpm: 148, fillersPerMinute: 6.2, longestPauseSec: 1.8, durationSec: 68 },
};

function judgePrompt(f) {
  return `You are scoring one criterion of a speaking-practice scenario. Return JSON only.

CRITERION
${f.criterion}

TRANSCRIPT (turn 1 of 1)
${f.transcript}

OBJECTIVE METRICS (context only - do not re-judge these)
${JSON.stringify(f.metrics)}

AMBIGUOUS WORDS
For each entry below, rule whether it was used as a filler or legitimately, using the surrounding context.
${JSON.stringify(f.ambiguous)}

RULES
- structurePass: true only if the criterion is met.
- evidence: quote or reference something the speaker actually said. Never generic.
- nextAction: exactly one sentence, exactly one action.
- fillerRulings: one entry per ambiguous word above, same word and index.`;
}

app.post('/api/judge', async (req, res) => {
  const {
    runs = 5,
    // Pinned per the Findings block: opus-5 is the only model tested that
    // catches a trailing-off close. Effort low is the latency lever.
    model = 'claude-opus-5',
    thinking = 'adaptive', // 'adaptive' | 'disabled'
    effort = 'low',
  } = req.body || {};

  const results = [];
  try {
    for (let i = 0; i < runs; i += 1) {
      const t0 = process.hrtime.bigint();
      const params = {
        model,
        max_tokens: 16000,
        output_config: { effort, format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
        messages: [{ role: 'user', content: judgePrompt(FIXTURE) }],
      };
      // Thinking is ON by default on claude-opus-5. Disabling is only legal at
      // effort high or below - measure whether it costs us verdict quality.
      if (thinking === 'disabled') params.thinking = { type: 'disabled' };

      const response = await anthropic.messages.create(params);
      const latencyMs = ms(t0);

      if (response.stop_reason === 'refusal') {
        results.push({ run: i, latencyMs, refused: true, stopDetails: response.stop_details });
        continue;
      }

      const text = response.content.find((b) => b.type === 'text')?.text ?? '';
      let parsed = null;
      let parseError = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parseError = e.message;
      }

      results.push({
        run: i,
        latencyMs,
        stopReason: response.stop_reason,
        usage: response.usage,
        parseError,
        raw: parseError ? text : undefined,
        verdict: parsed,
      });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ error: err.message, status: err.status, resultsSoFar: results });
  }

  // Stability: does the same input produce the same verdict every time?
  const ok = results.filter((r) => r.verdict);
  const passes = [...new Set(ok.map((r) => r.verdict.structurePass))];
  const rulingKey = (r) =>
    JSON.stringify((r.verdict.fillerRulings || []).map((x) => [x.word, x.isFiller]));
  const rulingSets = [...new Set(ok.map(rulingKey))];
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  res.json({
    config: { model, thinking, effort, runs },
    stability: {
      structurePassStable: passes.length === 1,
      structurePassValues: passes,
      fillerRulingsStable: rulingSets.length === 1,
      distinctRulingSets: rulingSets.length,
      nextActions: ok.map((r) => r.verdict.nextAction),
      parseFailures: results.filter((r) => r.parseError).length,
    },
    latency: {
      minMs: latencies[0],
      medianMs: latencies[Math.floor(latencies.length / 2)],
      maxMs: latencies[latencies.length - 1],
    },
    results,
  });
});

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    groqKey: Boolean(process.env.GROQ_API_KEY),
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  }),
);

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`spike server on http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) console.warn('  GROQ_API_KEY missing');
  if (!process.env.ANTHROPIC_API_KEY) console.warn('  ANTHROPIC_API_KEY missing');
});
