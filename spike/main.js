// Phase 0 spike client. Throwaway. All real audio code lands in
// client/src/audio/ during Phase 2.

const $ = (id) => document.getElementById(id);
const show = (el, obj) => { el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); };

// npm run dev starts vite and the API server together. Vite is ready in ~2s,
// the server takes ~4s to load the SDKs - so a one-shot check on page load
// races the server and loses. Poll until it answers.
const STATUS_COLOUR = {
  working: '#6BA368',
  missing: '#9A968E',       // optional and absent is not an error
  'no credits': '#C0614F',
  'rate limited': '#C99A3E',
  invalid: '#C0614F',
  error: '#C0614F',
};

function renderPreflight(data) {
  const rows = data.checks.map((c) => {
    const required = /^required/.test(c.note);
    const colour = STATUS_COLOUR[c.status] || '#C0614F';
    return `<tr>
      <td style="padding:3px 10px 3px 0"><b>${c.label}</b>${required ? '' : ' <span style="opacity:.6">(optional)</span>'}</td>
      <td style="padding:3px 10px 3px 0;color:${colour}"><b>${c.status.toUpperCase()}</b></td>
      <td style="padding:3px 0;opacity:.85">${c.detail}</td>
    </tr>`;
  });

  $('health').innerHTML =
    `<table style="border-collapse:collapse;font-size:12px">${rows.join('')}</table>`
    + `<p style="font-size:12px;opacity:.7;margin:6px 0 0">`
    + `Verified with ${data.verifiedWith}. A key can authenticate and still fail every `
    + `real call, so this checks usability rather than validity.</p>`;

  const stt = data.checks.filter((c) => ['groq', 'openai', 'deepgram'].includes(c.id));
  $('sttEngines').innerHTML = stt
    .map((c) => (c.ok
      ? `<b style="color:${STATUS_COLOUR.working}">${c.label}</b>`
      : `<span style="opacity:.6">${c.label} - ${c.status}</span>`))
    .join(' &nbsp;|&nbsp; ');
}

// The server loads its SDKs for a few seconds, so a one-shot check on page load
// races it and loses. Poll until it answers.
async function checkHealth(attempt = 0) {
  const el = $('health');
  try {
    const res = await fetch('/api/preflight');
    if (res.status === 404) {
      el.style.color = '#C0614F';
      el.innerHTML = 'The API server is running <b>older code</b> - it has no /api/preflight. '
        + 'Stop and restart <code>npm run dev</code>.';
      $('sttEngines').textContent = 'unavailable until the server is restarted';
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    el.style.color = '';
    renderPreflight(await res.json());
  } catch (err) {
    if (attempt < 15) {
      el.textContent = `checking keys against each provider... (${attempt + 1}/15)`;
      el.style.color = '#C99A3E';
      setTimeout(() => checkHealth(attempt + 1), 1000);
    } else {
      el.style.color = '#C0614F';
      el.innerHTML =
        `API server not reachable on :3001 after 15s (${err.message}). `
        + 'Check the <b>server</b> pane of <code>npm run dev</code> for a crash, '
        + 'then <button id="retry">retry</button>';
      $('retry').onclick = () => checkHealth(0);
      $('sttEngines').textContent = 'unavailable - the API server is not responding';
    }
  }
}
checkHealth();

// ---------------------------------------------------------------- recording
let mediaRecorder;
let stream;
let audioCtx;
let analyser;
let rafId;
let chunks = [];
let envelope = []; // { t, peak } sampled during recording
let recordStart = 0;
let mimeType = '';
let appliedConstraints = {};

// dBFS from the recorded envelope. A take too quiet to score should be caught
// here, before it reaches the judge, not explained away afterwards.
function levelReport() {
  if (!envelope.length) return null;
  const peaks = envelope.map((s) => s.peak);
  const rms = Math.sqrt(peaks.reduce((a, p) => a + p * p, 0) / peaks.length);
  const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -Infinity);
  return {
    peakDbfs: db(Math.max(...peaks)),
    rmsDbfs: db(rms),
    // Fraction of the take below a rough speech floor - high means mumbling
    // or a mic too far away, whatever the peak says.
    quietFraction: +(peaks.filter((p) => p < 0.02).length / peaks.length).toFixed(2),
  };
}

const canvas = $('wave');
const ctx2d = canvas.getContext('2d');

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

// Live: scrolling bars, right to left.
function drawLive() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);

  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
  envelope.push({ t: audioCtx.currentTime - recordStart, peak });

  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = '#6BA368';
  const barW = 3, gap = 2, step = barW + gap;
  const visible = Math.floor(w / step);
  const slice = envelope.slice(-visible);
  slice.forEach((s, i) => {
    const barH = Math.max(2, s.peak * h * 0.9);
    ctx2d.fillRect(i * step, (h - barH) / 2, barW, barH);
  });

  $('timer').textContent = `${(audioCtx.currentTime - recordStart).toFixed(1)}s`;
  rafId = requestAnimationFrame(drawLive);
}

const MARK = {
  pause: 'rgba(201,154,62,0.30)',   // wash behind the bars
  ambiguous: '#C99A3E',             // amber - filler only if Claude rules it one
  definite: '#C0614F',              // red - always a filler
};

// Static: full duration fitted to width, with markers from the word array.
// metricsError is drawn on the canvas: a blank waveform must never be
// mistakable for "you had no fillers".
function drawStatic(metrics, metricsError) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const total = envelope.length ? envelope[envelope.length - 1].t : 1;
  ctx2d.clearRect(0, 0, w, h);

  ctx2d.fillStyle = '#9A968E';
  const barW = 3, gap = 2, step = barW + gap;
  const bars = Math.floor(w / step);
  for (let i = 0; i < bars; i += 1) {
    const from = (i / bars) * total;
    const to = ((i + 1) / bars) * total;
    const seg = envelope.filter((s) => s.t >= from && s.t < to);
    const peak = seg.length ? Math.max(...seg.map((s) => s.peak)) : 0;
    const barH = Math.max(2, peak * h * 0.9);
    ctx2d.fillRect(i * step, (h - barH) / 2, barW, barH);
  }

  if (metricsError) {
    ctx2d.fillStyle = '#C0614F';
    ctx2d.font = '12px ui-monospace, monospace';
    ctx2d.fillText(`not scored: ${metricsError}`, 8, 16);
    return;
  }
  if (!metrics) return;

  // Whisper's clock starts at the first word; the envelope's starts at
  // recordStart. Offsetting by the first word keeps markers on the bars.
  const t0 = metrics.firstWordStart ?? 0;
  const x = (t) => ((t - t0) / total) * w;

  ctx2d.fillStyle = MARK.pause;
  (metrics.pauseMarks || []).forEach((p) => {
    ctx2d.fillRect(x(p.start), 0, Math.max(2, x(p.end) - x(p.start)), h);
  });

  // Ambiguous fillers get a half-height amber foot so they read as distinct
  // from the full-height pause wash and from a confirmed filler.
  ctx2d.fillStyle = MARK.ambiguous;
  (metrics.ambiguousMarks || []).forEach((m) => {
    ctx2d.fillRect(x(m.start), h * 0.5, Math.max(3, x(m.end) - x(m.start)), h * 0.5);
  });

  ctx2d.fillStyle = MARK.definite;
  (metrics.fillerMarks || []).forEach((m) => {
    ctx2d.fillRect(x(m.start), 0, Math.max(3, x(m.end) - x(m.start)), h);
  });

  $('legend').textContent =
    `red = filler (${metrics.fillerCount})   ` +
    `amber foot = ambiguous, Claude rules it (${metrics.ambiguousCount})   ` +
    `amber wash = pause > 2s (${metrics.pauseCount2s})`;
}

$('rec').onclick = async () => {
  // getUserMedia({ audio: true }) silently enables Chrome's WebRTC chain:
  // noise suppression, auto gain, echo cancellation. Noise suppression is
  // tuned to delete short low-energy non-speech - which is exactly what an
  // "um" looks like. Whisper itself is proven robust (see probe-*.js: no
  // filler lost at -56 dBFS or 5 dB SNR), so this chain is the live suspect.
  const raw = $('rawAudio').checked;
  const constraints = {
    audio: raw
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : true,
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    show($('sttOut'), `Microphone denied or unavailable: ${err.name} - ${err.message}`);
    return;
  }
  appliedConstraints = stream.getAudioTracks()[0]?.getSettings() ?? {};

  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  audioCtx.createMediaStreamSource(stream).connect(analyser);

  // Record what the browser actually gives us - do not force a mime type.
  // Bitrate is raised because MediaRecorder's opus default is tuned for calls.
  mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
  mimeType = mediaRecorder.mimeType;
  chunks = [];
  envelope = [];
  mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  recordStart = audioCtx.currentTime;
  mediaRecorder.start();
  drawLive();

  $('rec').disabled = true;
  $('stop').disabled = false;
  show($('sttOut'), `recording... browser mimeType: ${mimeType}`);
};

$('stop').onclick = async () => {
  $('stop').disabled = true;
  cancelAnimationFrame(rafId);
  // The budget starts the instant the user stops speaking, so the clock does
  // too - transcription and both TTS engines are measured against this.
  const stopClickedAt = performance.now();

  const blob = await new Promise((resolve) => {
    mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    mediaRecorder.stop();
  });
  stream.getTracks().forEach((t) => t.stop());

  const recordedSec = envelope.length ? envelope[envelope.length - 1].t : 0;
  drawStatic(null, null);
  show($('sttOut'), `uploading ${blob.size} bytes (${mimeType})...`);

  const ext = (mimeType.split('/')[1] || 'webm').split(';')[0];
  const form = new FormData();
  form.append('audio', blob, `answer.${ext}`);

  const url = `/api/transcribe?verbatim=${$('verbatim').checked ? 1 : 0}&ext=${ext}&model=${$('sttModel').value}`;
  const t0 = performance.now();
  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json();
  const roundTripMs = Math.round(performance.now() - t0);

  drawStatic(data.metrics, data.metricsError);

  const firstWord = data.words?.[0];
  show($('sttOut'), {
    BROWSER: {
      mimeType,
      blobBytes: blob.size,
      recordedSec: +recordedSec.toFixed(2),
      roundTripMs,
      audioProcessing: $('rawAudio').checked ? 'DISABLED (raw mic)' : 'Chrome default (NS/AGC/AEC on)',
      appliedConstraints,
    },
    LEVEL: levelReport(),
    CONFIDENCE: data.confidence, // does Whisper know it did badly?
    ALIGNMENT: {
      // If these disagree badly, waveform markers will drift.
      recordedSec: +recordedSec.toFixed(2),
      whisperDurationSec: data.metrics?.durationSec ?? null,
      firstWordStartSec: firstWord?.start ?? null,
      driftSec: data.metrics ? +(recordedSec - data.metrics.durationSec).toFixed(2) : null,
    },
    ...data,
  });

  $('rec').disabled = false;

  // Same audio, every engine, scored against the reference.
  if ($('compareStt').checked) await runSttCompare(blob, ext);

  // The interviewer's follow-up, spoken back through Groq. Measured from the
  // stop click so it lands against the < 2s budget.
  await speakAndReport($('ttsText').value, stopClickedAt);
};

// ------------------------------------------------------------ STT bake-off
// Engine availability is rendered by renderPreflight above, from a real call
// per provider - not from whether an env var happens to be set.

const pct = (n) => (n === null || n === undefined ? '-' : `${(n * 100).toFixed(1)}%`);

function renderSttTable(data) {
  const rows = data.summary.map((s) => {
    // Word timestamps are the gate, so a failure there is called out as
    // disqualifying rather than shown as one weak column among many.
    const gate = s.wordTimestamps ? 'yes' : 'NO - DISQUALIFIED';
    const cells = [
      s.engine,
      s.error ? `<span style="color:#C0614F">${s.error}</span>` : gate,
      s.latencyMs ?? '-',
      pct(s.verbatimWer),
      pct(s.contentWer),
      s.fillerRetention === null ? '-' : pct(s.fillerRetention),
      s.fillersFound ?? '-',
    ];
    const win = s.engine === data.winnerByVerbatimWer;
    return `<tr${win ? ' style="font-weight:700"' : ''}>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  });

  $('sttTable').innerHTML =
    '<table style="border-collapse:collapse;width:100%;font-size:12px;margin:8px 0">'
    + '<thead><tr>'
    + ['engine', 'word timestamps', 'latency ms', 'verbatim WER', 'content WER', 'filler retention', 'fillers found']
      .map((h) => `<th style="text-align:left;border-bottom:1px solid #999;padding:4px">${h}</th>`).join('')
    + '</tr></thead><tbody>'
    + rows.join('').replace(/<td>/g, '<td style="padding:4px;border-bottom:1px solid #ddd">')
    + '</tbody></table>'
    + `<p>lower WER is better. <b>verbatim</b> counts a dropped "um" as an error, which is the `
    + `axis that matters here; <b>content</b> ignores fillers on both sides and measures pure `
    + `accuracy. Winner by verbatim WER: <b>${data.winnerByVerbatimWer ?? 'none'}</b></p>`;
}

async function runSttCompare(blob, ext) {
  $('sttTable').innerHTML = '';
  show($('compareOut'), 'transcribing on every configured engine...');

  const form = new FormData();
  form.append('audio', blob, `answer.${ext}`);
  form.append('reference', $('sttReference').value);
  form.append('ext', ext);

  const res = await fetch('/api/stt-compare', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) { show($('compareOut'), data); return; }

  renderSttTable(data);
  show($('compareOut'), data);
}

// --------------------------------------------------------------------- TTS
// Groq orpheus only. Kokoro-82M was evaluated and rejected: Groq was ~4x
// faster to ready and sounded better in a blind A/B. See spec/phase-0-spike.md.
$('listModels').onclick = async () => {
  show($('ttsOut'), 'loading...');
  show($('ttsOut'), await (await fetch('/api/models')).json());
};

let lastTtsClip = null;
let ttsPlayer = null;

async function speakGroq(text, voice) {
  const t0 = performance.now();
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model: 'canopylabs/orpheus-v1-english', voice }),
  });
  if (!res.ok) throw new Error(JSON.stringify(await res.json()));

  const blob = new Blob([await res.arrayBuffer()], { type: 'audio/wav' });
  return {
    engine: 'groq orpheus-v1-english',
    voice,
    readyMs: Math.round(performance.now() - t0),
    serverFirstByteMs: Number(res.headers.get('X-First-Byte-Ms')),
    serverCompleteMs: Number(res.headers.get('X-Complete-Ms')),
    streamChunks: Number(res.headers.get('X-Chunks')), // 1 = no real streaming
    bytes: blob.size,
    blob,
  };
}

function playClip(clip, label) {
  if (ttsPlayer) { ttsPlayer.pause(); URL.revokeObjectURL(ttsPlayer.src); }
  // The element must outlive this call or playback can be collected mid-play.
  ttsPlayer = new Audio(URL.createObjectURL(clip.blob));
  ttsPlayer.onerror = () => {
    $('playOut').textContent = `${label}: decode failed (media error ${ttsPlayer.error?.code})`;
  };
  ttsPlayer.play()
    .then(() => { $('playOut').textContent = `playing ${label}`; })
    .catch((e) => { $('playOut').textContent = `${label}: ${e.name} - ${e.message}`; });
}

async function speakAndReport(text, sinceStop = null) {
  $('playOut').textContent = 'generating...';
  try {
    const clip = await speakGroq(text, $('ttsVoice').value);
    lastTtsClip = clip;
    $('replayTts').disabled = false;
    $('replayTts').onclick = () => playClip(lastTtsClip, 'Groq');
    playClip(clip, 'Groq');

    show($('ttsOut'), {
      ...clip,
      blob: undefined,
      sinceStopMs: sinceStop === null ? null : Math.round(performance.now() - sinceStop),
      BUDGET: 'target < 2000ms from user stop to AI question audible',
      NOTE: 'streamChunks 1 means no streaming - the interviewer card needs a '
        + 'thinking state, and the next question should be pre-generated during '
        + 'the user turn.',
    });
  } catch (err) {
    $('playOut').textContent = `Groq failed: ${err.message}`;
    show($('ttsOut'), { error: err.message });
  }
}

$('tts').onclick = () => speakAndReport($('ttsText').value);

// ------------------------------------------------------------------- judge
$('judge').onclick = async () => {
  show($('judgeOut'), 'running 5 identical requests...');
  const res = await fetch('/api/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runs: 5, thinking: $('thinking').value, effort: $('effort').value }),
  });
  show($('judgeOut'), await res.json());
};
