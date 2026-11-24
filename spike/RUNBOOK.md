# Phase 0 spike - runbook

Throwaway. Deleted once the Findings block in `spec/phase-0-spike.md` is filled in.

## Run it

1. Put `GROQ_API_KEY` and `ANTHROPIC_API_KEY` in `spike/.env`.
   Optional for the STT bake-off: `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`.
2. From `spike/`: `npm run dev`
3. Open http://localhost:5174

The top of the page runs a **preflight**: one real 0.4s request per provider, so it
reports whether each key actually *works*, not merely whether it is set. Statuses:

- `WORKING` - a real request succeeded
- `MISSING` - no key set. Fine for the optional providers
- `NO CREDITS` - the key is valid but the account is out of credit. This is the
  trap an auth-only check misses: `GET /v1/models` returns 200 while every
  transcription returns 429
- `INVALID` - wrong, expired, or revoked
- `RATE LIMITED` - valid, just too many requests right now

Groq and Anthropic must both say WORKING. If the page says the server is running
older code, restart `npm run dev` - Vite hot-reloads, the Express server does not.

## What to do, in order

### 1. Groq models (Spike 3, first half)

Click **List Groq models**. Copy the whole output back.

This answers whether `canopylabs/orpheus-v1-english` actually exists on Groq today, and
what the real Whisper and TTS model ids are. If orpheus is absent, put a model from the
`tts` list into the model box before running the TTS test.

### 2. Recording A - the capture-chain test (Spike 1, 2, 5) - now the critical one

The filler question is **already answered** - see the Findings block. Groq Whisper keeps
every filler, needs no verbatim prompt, and holds up at -56 dBFS and 5 dB SNR. Run
`node probe-fillers.js` to reproduce.

So if fillers go missing from a real browser recording, the model did not eat them -
something between the microphone and the upload did. That is what this step isolates.

Leave **verbatim prompt bias** OFF. Leave **raw mic** ON. Record:

> "So, um, I basically, like, built this thing, uh, you know, for tracking, I mean, expenses."

Say it at a normal speaking volume, articulated. Click **Stop and transcribe**.

Then untick **raw mic** and record the same sentence the same way.

The two runs differ only in whether Chrome's noise suppression, auto gain, and echo
cancellation are applied. Copy back both `sttOut` blocks. What matters:

- `transcript` - which fillers survived each run
- `LEVEL.rmsDbfs` and `LEVEL.quietFraction` - was the take actually loud enough
- `CONFIDENCE.meanAvgLogprob` - clean speech is -0.06 to -0.12; well below that
  means the audio was not intelligible, whatever the transcript says
- `BROWSER.appliedConstraints` - what the browser actually honoured
- `ALIGNMENT.driftSec` - how far the waveform will drift from the markers

If raw mic keeps the fillers and processed drops them, noise suppression is the culprit
and the real app must request raw audio. That is the whole point of this step.

### 3. Recording B - a normal answer (Spike 2, 5)

Verbatim off. Record a natural 60-second answer to "Tell me who you are and what you're
preparing for." Pause deliberately for 3+ seconds somewhere in the middle so the pause
detection has something to find.

Copy back `sttOut`, and tell me whether the markers line up with where you actually said
those things. The waveform now paints three things, not two:

- **red full-height** - definite filler (um, uh, you know, i mean)
- **amber half-height foot** - ambiguous word (so, like, basically, actually, right);
  Claude rules filler-or-not at scoring time, so it cannot be red yet
- **amber wash** - pause over 2s

If a take cannot be scored the canvas now says so in red text instead of drawing an
empty waveform, which previously looked identical to "you had no fillers".

### 3b. STT bake-off - which transcription engine

Without a mic:

```
powershell -ExecutionPolicy Bypass -File gen-samples.ps1   # once
node probe-stt.js            # both samples, every configured engine
node probe-stt.js sampleA    # just the filler test
```

With a mic: type what you are **about to say** into the reference box, tick
**run the bake-off on the next recording**, and record. Every engine gets the same
audio and is scored against your reference.

Two WER columns, and they answer different questions:

- **verbatim WER** - a dropped "um" counts as an error. This is the axis that
  decides it, because fillers are the product.
- **content WER** - fillers removed from both sides. Pure transcription accuracy.

**Word timestamps are a hard gate.** An engine showing `NO - DISQUALIFIED` cannot
score a scenario at all, whatever its WER.

To add engines, put the key in `spike/.env` and restart:

- `OPENAI_API_KEY` - whisper-1. Note this is Whisper large-v2, an *older* model
  than Groq already runs. OpenAI's newer gpt-transcribe models cannot return
  word timestamps and are disqualified.
- `DEEPGRAM_API_KEY` - Nova-3 with `filler_words=true`, the only engine found
  that deliberately keeps disfluencies instead of stripping them.

### 4. TTS (Spike 3, second half)

Groq orpheus is the decided engine. Kokoro-82M was evaluated in-browser and
rejected: Groq reached ready about 4x faster and sounded better in a blind A/B.
kokoro-js has been uninstalled.

Groq measured 1139ms with `streamChunks: 1`, meaning **no streaming** - the whole
file generates before playback. So the interviewer card needs a thinking state, and
the next question should be pre-generated during the user's turn.

Click **Speak**, or just record - step 2 speaks the interviewer's follow-up
automatically and reports `sinceStopMs`, measured from the moment you stopped
speaking, against the < 2s budget.

### 5. Claude verdict stability (Spike 4)

Already decided: **claude-opus-5, effort low, adaptive thinking** - pinned in
server.js. opus scored 3/3 on graded transcripts, sonnet-5 only 2/3 (it passes an
answer that trails off, the exact failure a speaking rubric exists to catch).
Re-run only if you want to re-check after a rubric change.

## Note on the spec

`spec/scoring.md` specifies `temperature: 0` for the judge. That parameter has been
**removed on claude-opus-5 and returns a 400** - it is no longer available as a
determinism lever. Stability now has to come from the strict output schema and the
prompt, which is what step 5 measures. I will update `spec/scoring.md` once we have
the numbers.
