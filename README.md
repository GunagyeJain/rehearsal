# Rehearsal

Rehearsal is a speaking-practice web app. You record short spoken answers to roleplayed scenarios (interview, viva, standup, pitch), get scored against fixed rubrics, and work through a personalised path of scenarios. It is a MERN app that uses the Claude API for generating lines and judging answers, and Groq for speech-to-text and text-to-speech.

## Prerequisites

- Node.js 24
- MongoDB, running locally (`mongodb://127.0.0.1:27017`) or reachable via an Atlas URI
- An Anthropic API key and a Groq API key

## Setup

```sh
npm install
```

Create `server/.env` with these variables (names only; never commit real values):

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | `mongodb://` or `mongodb+srv://` connection string |
| `ANTHROPIC_API_KEY` | yes | Claude API, used only from `server/src/services/claude.ts` |
| `GROQ_API_KEY` | yes | Groq Whisper (STT) and TTS, used only from `server/src/services/groq.ts` |
| `JWT_SECRET` | yes | Session cookie signing, at least 16 characters |
| `PORT` | no | API port, default 4000 |
| `HOST` | no | Bind address, default `127.0.0.1` (loopback only; set it deliberately to expose the server) |
| `TRUST_PROXY` | no | Express `trust proxy`. Set `TRUST_PROXY=1` in development, where requests arrive through the Vite proxy, so per-IP rate limits see the real client. Unset or `false` trusts no proxy. |
| `SCENARIOS_DIR` | no | Override for the scenario folder, mainly for tests |

The server validates the environment at startup and names any missing or invalid keys (never their values).

## Scripts

Run from the repository root:

| Command | What it does |
|---|---|
| `npm run dev` | Server on :4000 and client on :5173 together (the Vite dev server proxies `/api` to the server; override with `API_PORT` and `PORT`) |
| `npm run dev -w server` / `npm run dev -w client` | One side only |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint across the repo |
| `npm test` | Vitest in every workspace (server integration tests need MongoDB; they use the `rehearsal_test` database) |
| `npm run build` | Production build of the client |

## Architecture

| Path | Contents |
|---|---|
| `shared/` | Types, zod request schemas, and pure scoring code shared by server and client (the API contract in code) |
| `server/src/routes/` | Express endpoints. They validate input and never call an external API directly. |
| `server/src/services/` | The only place external APIs are called: `claude.ts`, `groq.ts`, plus `scoring.ts` and `path.ts` |
| `server/src/models/` | Mongoose models; audio blobs live in GridFS (bucket `recordings`) |
| `client/src/screens/` | React + Vite + TypeScript, one route per screen |
| `client/src/audio/` | All browser media code: recording, Web Audio analyser, waveform |
| `content/scenarios/*.json` | Scenario definitions. Data, not code. |
| `spec/` | Product, scoring, data model, screens, design tokens, and the API contract (`spec/api.md`) |

Rubrics are fixed and never AI-generated; only scenario lines are generated at runtime. Transcription is server-side Groq Whisper (word timestamps drive fillers, pauses, pace and waveform markers); the browser Web Speech API is not used.

## Testing notes

- **Fake microphone.** For browser testing without speaking, synthesize answers with Windows SAPI (see `spike/gen-samples.ps1`) and inject them by overriding `navigator.mediaDevices.getUserMedia` to return a stream from the decoded audio. Never use live TTS to produce test audio.
- **Groq TTS quota.** The Groq TTS daily quota can run out. When it does, the upstream returns 429 and the client falls back to the browser's `speechSynthesis` to speak the line. That fallback is expected behaviour, not a bug.
- **Rate limits.** Auth routes are rate limited per IP. Behind the Vite proxy, set `TRUST_PROXY=1` so limits apply per client rather than to the proxy.

## Privacy rules

- Audio belongs to the user. Every query is scoped by `userId`; no endpoint returns another user's audio or attempt (another user's id is a 404).
- Audio, transcripts and word arrays are never logged. Server errors are logged with `server/src/http/safeErrorLabel.ts`, never with request bodies.
- Free text is never sent to TTS; only stored scenario lines and the fixed baseline prompt can be synthesized.
- Users can delete individual recordings, all recordings, or their whole account. Account deletion removes the user, path, progress, attempts, recordings documents and GridFS blobs.
