// The findings record opus-5 ruling false and sonnet-5 ruling true on the same
// transcript. Latency says pick sonnet. That is only safe if sonnet can still
// tell a good answer from a bad one - a judge that passes everything is worse
// than a slow one. Three transcripts, graded difficulty, both models.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CRITERION =
  'The introduction covers, in order: who they are, what they do, one specific concrete detail (a project, a result, an interest), and closes cleanly rather than trailing off.';

const SCHEMA = {
  type: 'object',
  properties: {
    structurePass: { type: 'boolean' },
    evidence: { type: 'string' },
    nextAction: { type: 'string' },
  },
  required: ['structurePass', 'evidence', 'nextAction'],
  additionalProperties: false,
};

const CASES = [
  {
    name: 'CLEAN PASS (all four parts, clean close)',
    expect: true,
    transcript:
      "I'm Priya, a final year computer engineering student at Thapar. I work on scheduling systems. Last semester I built a solver in Python for our department timetable that cut clashes by forty percent. I'm looking for systems roles now, and that's what I'd like to talk about today.",
  },
  {
    name: 'TRAILS OFF (has content, bad close)',
    expect: false,
    transcript:
      "So, um, hi, I'm Priya and I'm a final year computer engineering student at Thapar. I've basically been working on, like, a scheduling tool for our department that cut timetable clashes by about forty percent, and, uh, I built the solver in Python. I mean, I'm really interested in systems work and, you know, that's kind of what I want to do next. Yeah, so that's me I guess.",
  },
  {
    name: 'NO CONCRETE DETAIL (vague throughout)',
    expect: false,
    transcript:
      "Hi, I'm Priya. I'm a student and I do a lot of coding and software things. I've worked on various projects that went pretty well and I learned a lot from them. I'm interested in technology generally and I think I'd be a good fit for lots of different roles. Thank you.",
  },
];

const prompt = (t) => `You are scoring one criterion of a speaking-practice scenario. Return JSON only.

CRITERION
${CRITERION}

TRANSCRIPT (turn 1 of 1)
${t}

RULES
- structurePass: true only if the criterion is met.
- evidence: quote or reference something the speaker actually said. Never generic.
- nextAction: exactly one sentence, exactly one action.`;

for (const model of ['claude-opus-5', 'claude-sonnet-5']) {
  console.log(`\n########## ${model} (effort low, adaptive thinking) ##########`);
  let correct = 0;
  for (const c of CASES) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = Date.now();
      const r = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: prompt(c.transcript) }],
      });
      const v = JSON.parse(r.content.find((b) => b.type === 'text').text);
      runs.push({ pass: v.structurePass, ms: Date.now() - t0, evidence: v.evidence });
    }
    const verdicts = [...new Set(runs.map((r) => r.pass))];
    const stable = verdicts.length === 1;
    const got = runs[0].pass;
    const ok = stable && got === c.expect;
    if (ok) correct += 1;
    console.log(`\n  ${c.name}`);
    console.log(`    expected ${c.expect} | got ${verdicts.join('/')} | stable ${stable} | ${ok ? 'CORRECT' : 'WRONG'}`);
    console.log(`    latency ms: ${runs.map((r) => r.ms).join(', ')}`);
    console.log(`    evidence: ${runs[0].evidence.slice(0, 120)}`);
  }
  console.log(`\n  >>> ${model}: ${correct}/${CASES.length} cases correct and stable`);
}
