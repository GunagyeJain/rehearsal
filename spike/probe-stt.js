// STT bake-off from the terminal, so engines can be compared without a mic.
// Same engine list and same scoring the browser uses.
//
//   node probe-stt.js            both samples
//   node probe-stt.js sampleB    one sample
import 'dotenv/config';
import fs from 'node:fs';
import { availableEngines } from './stt-engines.js';
import { scoreAgainstReference } from './wer.js';
import { computeMetrics } from './metrics.js';

const SAMPLES = {
  sampleA: {
    file: 'sampleA.wav',
    reference:
      'So, um, I basically, like, built this thing, uh, you know, for tracking, I mean, expenses.',
    tests: 'filler retention',
  },
  sampleB: {
    file: 'sampleB.wav',
    reference:
      'The salt breeze drifted softly through the cracked window, carrying the faint, rhythmic '
      + 'sound of distant waves hitting the shore. An old wooden chair creaked on the porch as the '
      + 'afternoon sun began to dip below the horizon, painting the sky in soft shades of orange '
      + 'and violet. A solitary seagull circled lazily above the empty docks, searching for a late '
      + 'meal before nightfall settled over the quiet harbor.',
    tests: 'content accuracy',
  },
};

const engines = availableEngines();
console.log('Engines:');
for (const e of engines) {
  console.log(`  ${e.available ? '[on] ' : '[off]'} ${e.label}${e.available ? '' : `  - set ${e.envKey} in spike/.env`}`);
}

const active = engines.filter((e) => e.available);
if (!active.length) { console.log('\nNo engine has a key. Nothing to do.'); process.exit(1); }

const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(SAMPLES);

for (const name of wanted) {
  const s = SAMPLES[name];
  if (!s) { console.log(`\nUnknown sample "${name}"`); continue; }

  const path = new URL(`./${s.file}`, import.meta.url);
  if (!fs.existsSync(path)) {
    console.log(`\n${name}: ${s.file} missing - run  powershell -File gen-samples.ps1`);
    continue;
  }
  const buf = fs.readFileSync(path);

  console.log(`\n\n##### ${name} - tests ${s.tests} #####`);
  console.log(`reference: "${s.reference.slice(0, 90)}${s.reference.length > 90 ? '...' : ''}"`);

  const rows = [];
  for (const e of active) {
    try {
      const t0 = Date.now();
      const out = await e.run(buf, s.file, 'audio/wav');
      const latencyMs = Date.now() - t0;
      const acc = scoreAgainstReference(s.reference, out.transcript);

      let fillers = null;
      let timestamps = false;
      try {
        const m = computeMetrics(out.words);
        fillers = m.fillerCount;
        timestamps = true;
      } catch { timestamps = false; }

      rows.push({
        engine: e.label,
        latencyMs,
        wordTs: timestamps,
        verbatimWer: acc.verbatimWer,
        contentWer: acc.contentWer,
        fillerRet: acc.fillerRetention,
        fillersFound: fillers,
      });
      console.log(`\n  ${e.label}`);
      console.log(`    "${out.transcript.trim().slice(0, 140)}"`);
    } catch (err) {
      rows.push({ engine: e.label, latencyMs: null, wordTs: false, verbatimWer: null, contentWer: null, fillerRet: null, fillersFound: null });
      console.log(`\n  ${e.label}\n    ERROR: ${err.message.slice(0, 160)}`);
    }
  }

  console.log('');
  console.table(rows);
  const best = rows.filter((r) => r.verbatimWer !== null).sort((a, b) => a.verbatimWer - b.verbatimWer)[0];
  if (best) console.log(`  lowest verbatim WER: ${best.engine} (${best.verbatimWer})`);
}
