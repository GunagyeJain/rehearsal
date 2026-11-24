// Word error rate against a known reference. Throwaway spike code.
//
// Two axes, because the two failures we have seen are different in kind:
//   verbatim WER  - reference kept whole, so an engine that silently strips
//                   "um" is penalised. This is the axis that matters for
//                   scoring, since fillers ARE the product.
//   content WER   - fillers removed from both sides, so this measures pure
//                   transcription accuracy on the words that carry meaning.
// An engine can win one and lose the other. Sample A was a filler-retention
// failure; Sample B was a content-accuracy failure.

// Kept in sync with metrics.js DEFINITE/AMBIGUOUS.
const FILLER_TOKENS = new Set([
  'um', 'uh', 'umm', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mmm',
  'like', 'basically', 'actually', 'right', 'so',
]);

export const tokenise = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

// Levenshtein over word tokens, with a backtrace so substitutions, deletions
// and insertions can be reported separately rather than as one opaque number.
export function align(refWords, hypWords) {
  const n = refWords.length;
  const m = hypWords.length;
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  let i = n;
  let j = m;
  const ops = { sub: 0, del: 0, ins: 0, hit: 0 };
  const detail = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (refWords[i - 1] === hypWords[j - 1] ? 0 : 1)) {
      if (refWords[i - 1] === hypWords[j - 1]) ops.hit += 1;
      else { ops.sub += 1; detail.push({ op: 'sub', ref: refWords[i - 1], hyp: hypWords[j - 1] }); }
      i -= 1; j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.del += 1; detail.push({ op: 'del', ref: refWords[i - 1] });
      i -= 1;
    } else {
      ops.ins += 1; detail.push({ op: 'ins', hyp: hypWords[j - 1] });
      j -= 1;
    }
  }

  return {
    ...ops,
    refLength: n,
    wer: n === 0 ? null : +((ops.sub + ops.del + ops.ins) / n).toFixed(4),
    detail: detail.reverse(),
  };
}

export function scoreAgainstReference(reference, hypothesis) {
  const ref = tokenise(reference);
  const hyp = tokenise(hypothesis);
  const strip = (ws) => ws.filter((w) => !FILLER_TOKENS.has(w));

  const verbatim = align(ref, hyp);
  const content = align(strip(ref), strip(hyp));

  // How many of the reference's fillers actually survived into the transcript.
  const refFillers = ref.filter((w) => FILLER_TOKENS.has(w));
  const hypFillers = hyp.filter((w) => FILLER_TOKENS.has(w));
  const counts = {};
  for (const w of refFillers) counts[w] = (counts[w] || 0) + 1;
  for (const w of hypFillers) counts[w] = (counts[w] || 0) - 1;

  return {
    verbatimWer: verbatim.wer,
    contentWer: content.wer,
    verbatim: { sub: verbatim.sub, del: verbatim.del, ins: verbatim.ins, refLength: verbatim.refLength },
    content: { sub: content.sub, del: content.del, ins: content.ins, refLength: content.refLength },
    fillersInReference: refFillers.length,
    fillersInTranscript: hypFillers.length,
    fillerRetention: refFillers.length === 0
      ? null
      : +(Math.min(hypFillers.length, refFillers.length) / refFillers.length).toFixed(3),
    fillerDelta: Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== 0)),
    worstErrors: verbatim.detail.filter((x) => x.op !== 'hit').slice(0, 25),
  };
}
