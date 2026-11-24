import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  capWords,
  cleanSpokenLine,
  createClaudeService,
  type GenerateTurnInput,
  type JudgeInput,
  type MessagesClient,
} from '../src/services/claude';

function message(text: string, stop: string = 'end_turn'): Anthropic.Message {
  // Test fake: only the fields the service reads are populated.
  return { content: [{ type: 'text', text }], stop_reason: stop } as unknown as Anthropic.Message;
}

function fakeClient(replies: (() => Promise<Anthropic.Message>)[]) {
  const create = vi.fn(async () => {
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    return next();
  });
  const client: MessagesClient = { messages: { create } };
  return { client, create };
}

const turnInput: GenerateTurnInput = {
  generate: 'Ask them to introduce themselves.',
  persona: 'A friendly interviewer.',
  scene: 'A quiet room.',
  yourGoal: 'Introduce yourself.',
  userInputs: {},
  profile: null,
  previousTurns: [],
};

const judgeInput: JudgeInput = {
  criteria: [{ id: 'structure', label: 'Structure', criterion: 'Clear beginning and end.' }],
  turns: [{ index: 0, aiText: 'Tell me about yourself.', transcript: 'I am Priya and I build schedulers.' }],
  metrics: {
    wpm: 140,
    fillersPerMinute: 1,
    longestPauseSec: 1,
    pauseCount2s: 0,
    durationSec: 30,
    speakingSec: 28,
    wordCount: 70,
    contentWordCount: 68,
    fillerCount: 1,
    fillerMarks: [],
    pauseMarks: [],
    paceWindows: [],
  },
  ambiguous: [{ id: 0, word: 'so', context: '[so] I am Priya' }],
};

const goodJudge = JSON.stringify({
  criteria: [{ id: 'structure', passed: true }],
  evidence: 'You opened with "I am Priya" and named a concrete project.',
  nextAction: 'Close with one sentence on what you want next. Then stop.',
  fillerRulings: [
    { id: 0, isFiller: true },
    { id: 99, isFiller: true },
  ],
});

describe('cleanSpokenLine', () => {
  it('strips wrapping quotes', () => {
    expect(cleanSpokenLine('"Tell me about yourself."')).toBe('Tell me about yourself.');
    expect(cleanSpokenLine('“Tell me about yourself.”')).toBe('Tell me about yourself.');
  });

  it('strips markdown, stage directions and speaker labels', () => {
    expect(cleanSpokenLine('Interviewer: *smiles* (leans in) **So**, tell me about yourself.')).toBe(
      'So, tell me about yourself.',
    );
  });
});

describe('capWords', () => {
  const long = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');

  it('leaves short lines alone', () => {
    expect(capWords('Tell me about yourself.')).toBe('Tell me about yourself.');
  });

  it('hard-caps at 40 words when there is no sentence end', () => {
    const capped = capWords(long);
    expect(capped.split(' ')).toHaveLength(40);
    expect(capped.endsWith('.')).toBe(true);
  });

  it('cuts at the last sentence end within 40 words', () => {
    const text = `First sentence here. ${long}`;
    expect(capWords(text)).toBe('First sentence here.');
  });
});

describe('generateTurnLine', () => {
  it('cleans and caps the model output', async () => {
    const words = Array.from({ length: 60 }, () => 'word').join(' ');
    const { client, create } = fakeClient([async () => message(`"${words}"`)]);
    const line = await createClaudeService(client).generateTurnLine(turnInput);
    expect(line.split(' ').length).toBeLessThanOrEqual(40);
    expect(line.startsWith('"')).toBe(false);
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.output_config).toEqual({ effort: 'low' });
  });

  it('sends the goal label and free-text detail, never the raw goal id', async () => {
    const { client, create } = fakeClient([async () => message('Tell me about yourself.')]);
    await createClaudeService(client).generateTurnLine({
      ...turnInput,
      profile: { goal: 'other', goalDetail: 'A pitch to my landlord', field: 'Design' },
    });
    const prompt = JSON.stringify((create.mock.calls[0] as unknown[])[0]);
    expect(prompt).toContain('Their goal: Something else: A pitch to my landlord. Their field: Design.');
    expect(prompt).not.toContain('Their goal: other');
  });

  it('uses the goal option label when there is no detail', async () => {
    const { client, create } = fakeClient([async () => message('Tell me about yourself.')]);
    await createClaudeService(client).generateTurnLine({
      ...turnInput,
      profile: { goal: 'viva', goalDetail: '', field: 'Physics' },
    });
    const prompt = JSON.stringify((create.mock.calls[0] as unknown[])[0]);
    expect(prompt).toContain('Their goal: A viva, oral exam or project defence. Their field: Physics.');
  });

  it('falls back to a neutral line after two failures', async () => {
    const { client, create } = fakeClient([
      async () => Promise.reject(new Error('boom')),
      async () => message('', 'refusal'),
    ]);
    const line = await createClaudeService(client).generateTurnLine(turnInput);
    expect(line).toBe("Let's begin. Introduce yourself.");
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('judgeAttempt', () => {
  it('parses a good reply, trims nextAction to one sentence and drops unknown ruling ids', async () => {
    const { client, create } = fakeClient([async () => message(goodJudge)]);
    const out = await createClaudeService(client).judgeAttempt(judgeInput);
    expect(out).not.toBeNull();
    expect(out?.nextAction).toBe('Close with one sentence on what you want next.');
    expect(out?.fillerRulings).toEqual([{ id: 0, isFiller: true }]);
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe('claude-opus-5');
    expect(params).not.toHaveProperty('temperature');
    expect(params.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
  });

  it('labels AI lines with the turn persona, not a hardcoded interviewer', async () => {
    const { client, create } = fakeClient([async () => message(goodJudge)]);
    await createClaudeService(client).judgeAttempt({
      ...judgeInput,
      turns: [
        { index: 0, aiText: 'What did you do yesterday?', transcript: 'I fixed the build.', persona: 'A direct, time-pressed manager' },
        { index: 1, aiText: 'Anything blocking?', transcript: 'No.' },
      ],
    });
    const prompt = JSON.stringify((create.mock.calls[0] as unknown[])[0]);
    expect(prompt).toContain('Prompt (A direct, time-pressed manager): What did you do yesterday?');
    expect(prompt).toContain('Prompt: Anything blocking?');
    expect(prompt).not.toContain('Interviewer:');
  });

  it('retries once on malformed JSON, then succeeds', async () => {
    const { client, create } = fakeClient([async () => message('not json'), async () => message(goodJudge)]);
    const out = await createClaudeService(client).judgeAttempt(judgeInput);
    expect(out?.criteria).toEqual([{ id: 'structure', passed: true }]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('returns null after a failure and a refusal', async () => {
    const { client, create } = fakeClient([
      async () => Promise.reject(new Error('down')),
      async () => message('', 'refusal'),
    ]);
    expect(await createClaudeService(client).judgeAttempt(judgeInput)).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('treats a reply missing a criterion as malformed', async () => {
    const missing = JSON.stringify({ criteria: [], evidence: 'x', nextAction: 'Do y.', fillerRulings: [] });
    const { client } = fakeClient([async () => message(missing), async () => message(missing)]);
    expect(await createClaudeService(client).judgeAttempt(judgeInput)).toBeNull();
  });
});

describe('generateBaselineFeedback', () => {
  const baselineInput = {
    transcript: 'hello',
    metrics: { wpm: 140, fillersPerMinute: 1, fillerCount: 1, longestPauseSec: 1, pauseCount2s: 0, durationSec: 30, wordCount: 70 },
  };
  const goodFeedback = JSON.stringify({ strength: 'You opened clearly.', observation: 'Try a closing line.' });

  it('asks the pinned model at low effort with a json_schema format', async () => {
    const { client, create } = fakeClient([async () => message(goodFeedback)]);
    const fb = await createClaudeService(client).generateBaselineFeedback(baselineInput);
    expect(fb).toEqual({ strength: 'You opened clearly.', observation: 'Try a closing line.' });
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
  });

  it('retries once after a refusal, then uses the reply', async () => {
    const { client, create } = fakeClient([async () => message('', 'refusal'), async () => message(goodFeedback)]);
    const fb = await createClaudeService(client).generateBaselineFeedback(baselineInput);
    expect(fb.strength).toBe('You opened clearly.');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('falls back to metric-derived lines when Claude fails twice', async () => {
    const { client } = fakeClient([
      async () => Promise.reject(new Error('a')),
      async () => Promise.reject(new Error('b')),
    ]);
    const fb = await createClaudeService(client).generateBaselineFeedback({
      transcript: 'hello',
      metrics: { wpm: 140, fillersPerMinute: 8, fillerCount: 4, longestPauseSec: 1, pauseCount2s: 0, durationSec: 30, wordCount: 70 },
    });
    expect(fb.strength.length).toBeGreaterThan(0);
    expect(fb.observation).toMatch(/filler/);
  });
});
