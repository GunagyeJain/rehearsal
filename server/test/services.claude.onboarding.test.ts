import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_MODELS,
  createClaudeService,
  fallbackBaselineFeedback,
  type MessagesClient,
  type PathGenerationInput,
} from '../src/services/claude';

function message(text: string, stop: string = 'end_turn'): Anthropic.Message {
  // Test fake: only the fields the service reads are populated.
  return { content: [{ type: 'text', text }], stop_reason: stop } as unknown as Anthropic.Message;
}

function fakeClient(replies: (() => Promise<Anthropic.Message>)[]) {
  const create = vi.fn(async (_params: Anthropic.MessageCreateParamsNonStreaming) => {
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    return next();
  });
  const client: MessagesClient = { messages: { create } };
  return { client, create };
}

const pathInput: PathGenerationInput = {
  profile: { goal: 'job-interview', goalDetail: '', timeframe: 'this-month', field: 'Biology', confidence: 2 },
  baseline: { wpm: 150, fillersPerMinute: 4, fillerCount: 3, longestPauseSec: 2.4, pauseCount2s: 1, durationSec: 45, wordCount: 110 },
  library: [{ id: 'self-introduction', track: 'fundamentals', title: 'Self introduction', difficulty: 1, description: 'Intro' }],
  goalTrack: 'professional',
};

describe('proposePath', () => {
  it('asks the pinned model for structured ids and returns them raw', async () => {
    const { client, create } = fakeClient([async () => message(JSON.stringify({ scenarioIds: ['self-introduction', 'x'] }))]);
    const ids = await createClaudeService(client).proposePath(pathInput);
    expect(ids).toEqual(['self-introduction', 'x']);
    const params = create.mock.calls[0]?.[0];
    expect(params?.model).toBe(CLAUDE_MODELS.pathGeneration);
    expect(params).not.toHaveProperty('temperature');
    expect(JSON.stringify(params?.output_config)).toContain('json_schema');
    const prompt = JSON.stringify(params?.messages);
    expect(prompt).toContain('professional');
    expect(prompt).toContain('A job or internship interview');
  });

  it('retries once after a refusal or malformed reply, then gives up with null', async () => {
    const { client, create } = fakeClient([async () => message('', 'refusal'), async () => message('not json')]);
    expect(await createClaudeService(client).proposePath(pathInput)).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('treats an empty list as unusable', async () => {
    const { client } = fakeClient([
      async () => message(JSON.stringify({ scenarioIds: [] })),
      async () => message(JSON.stringify({ scenarioIds: ['self-introduction'] })),
    ]);
    expect(await createClaudeService(client).proposePath(pathInput)).toEqual(['self-introduction']);
  });

  it('returns null when both calls throw', async () => {
    const { client } = fakeClient([async () => Promise.reject(new Error('a')), async () => Promise.reject(new Error('b'))]);
    expect(await createClaudeService(client).proposePath(pathInput)).toBeNull();
  });
});

describe('fallbackBaselineFeedback', () => {
  const base = { wpm: 140, fillersPerMinute: 1, fillerCount: 1, longestPauseSec: 1, pauseCount2s: 0, durationSec: 40, wordCount: 90 };

  it('always gives exactly one strength and one observation, never a verdict', () => {
    const cases = [base, { ...base, fillersPerMinute: 9 }, { ...base, wpm: 200 }, { ...base, wpm: 90, longestPauseSec: 5 }];
    for (const metrics of cases) {
      const fb = fallbackBaselineFeedback(metrics);
      for (const line of [fb.strength, fb.observation]) {
        expect(line.length).toBeGreaterThan(0);
        expect(line).not.toMatch(/fail|pass|score|grade|wrong/i);
      }
    }
  });

  it('names the metric with the most margin as the strength and the weakest as the observation', () => {
    // fillers 1/4 (margin 0.75), pace 145 (centre, margin 1), pause 3.9/4 (margin 0.025)
    const fb = fallbackBaselineFeedback({ ...base, wpm: 145, longestPauseSec: 3.9 });
    expect(fb.strength).toContain('145 wpm');
    expect(fb.observation).toContain('3.9s');
  });

  it('treats the filler threshold as inclusive: 4 per minute is at the edge, 4.5 is past it', () => {
    const atEdge = fallbackBaselineFeedback({ ...base, fillersPerMinute: 4 });
    expect(atEdge.observation).toContain('4.0 fillers per minute');
    const past = fallbackBaselineFeedback({ ...base, fillersPerMinute: 4.5 });
    expect(past.observation).toContain('4.5 fillers per minute');
    expect(past.strength).not.toContain('fillers');
  });

  it('reads pace against 120-170 at both edges', () => {
    expect(fallbackBaselineFeedback({ ...base, wpm: 119 }).observation).toContain('faster');
    expect(fallbackBaselineFeedback({ ...base, wpm: 171 }).observation).toContain('slowing down');
    expect(fallbackBaselineFeedback({ ...base, wpm: 171 }).strength).not.toContain('wpm');
  });

  it('falls back to a neutral strength when every metric is past its threshold', () => {
    const fb = fallbackBaselineFeedback({ ...base, fillersPerMinute: 9, wpm: 200, longestPauseSec: 8 });
    expect(fb.strength).toBe('You got a full answer out, which is the hardest part.');
    expect(fb.observation).toContain('fillers');
  });

  it('never uses a canned observation unrelated to the metrics', () => {
    for (const metrics of [base, { ...base, wpm: 160 }, { ...base, longestPauseSec: 0.5 }]) {
      expect(fallbackBaselineFeedback(metrics).observation).toMatch(/\d/);
    }
  });
});
