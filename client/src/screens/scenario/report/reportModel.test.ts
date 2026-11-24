import { describe, expect, it } from 'vitest';
import {
  buildVerdict,
  evaluateObjective,
  type AttemptDetailResponse,
  type Metrics,
  type Rubric,
} from '@rehearsal/shared';
import { buildReportModel } from './reportModel';

const rubric: Rubric = {
  objective: [
    { id: 'fillers', label: 'Filler words', metric: 'fillersPerMinute', op: 'lte', value: 4 },
    { id: 'pace', label: 'Speaking pace', metric: 'wpm', op: 'between', value: [120, 170] },
  ],
  judged: [{ id: 'structure', label: 'Structure', criterion: 'Covers who, what, a detail.' }],
};

const metrics: Metrics = {
  wpm: 184,
  fillersPerMinute: 2,
  longestPauseSec: 1,
  pauseCount2s: 0,
  durationSec: 60,
  speakingSec: 55,
  wordCount: 180,
  contentWordCount: 170,
  fillerCount: 2,
  fillerMarks: [
    { word: 'um', start: 1, end: 1.2, turnIndex: 0, wordIndex: 3, wordCount: 1 },
    { word: 'uh', start: 2, end: 2.2, turnIndex: 1, wordIndex: 1, wordCount: 1 },
  ],
  pauseMarks: [],
  paceWindows: [
    { turnIndex: 0, start: 0, end: 10, wpm: 190, partial: false },
    { turnIndex: 0, start: 10, end: 20, wpm: 150, partial: false },
  ],
};

function detail(overrides: Partial<AttemptDetailResponse['attempt']>, provisional: AttemptDetailResponse['provisional']): AttemptDetailResponse {
  return {
    attempt: {
      id: 'a1',
      scenarioId: 'self-introduction',
      userInputs: {},
      status: 'scoring',
      startedAt: '2026-11-23T00:00:00.000Z',
      completedAt: null,
      turns: [
        { index: 0, aiText: 'Hello', audioId: 'r0', transcript: 'hi', words: [{ word: 'hi', start: 0, end: 30 }], audioDurationSec: 31 },
        { index: 1, aiText: 'Tell me more', audioId: null, transcript: 'ok', words: [{ word: 'ok', start: 0, end: 12 }] },
      ],
      metrics: null,
      verdict: null,
      ...overrides,
    },
    scenario: { id: 'self-introduction', title: 'Self-introduction', track: 'fundamentals', rubric, criteriaDisplay: [] },
    provisional,
    progress: { status: 'available', attemptCount: 1, canSkip: false, nextScenarioId: null, onPath: false },
  };
}

describe('buildReportModel', () => {
  it('shows objective rows at once and the judged row as pending while scoring', () => {
    const model = buildReportModel(
      detail({}, { metrics, objective: evaluateObjective(rubric.objective, metrics), ambiguous: [{ id: 1, word: 'like', turnIndex: 0, wordIndex: 2 }] }),
    );

    expect(model.verdict).toBe('pending');
    expect(model.rows.map((r) => r.state)).toEqual(['met', 'not-met', 'pending']);
    expect(model.rows[1]?.detail).toBe('184 wpm, target 120-170 wpm');
    expect(model.rows[0]?.mayChange).toBe(true);
  });

  it('uses the verdict when scored and splits marks and pace drift per turn', () => {
    const verdict = buildVerdict({ rubric, metrics, judge: null });
    const model = buildReportModel(detail({ status: 'scored', metrics, verdict }, null));

    expect(model.verdict).toBe('passed');
    expect(model.judgeUnavailable).toBe(true);
    expect(model.turns[0]?.fillerMarks).toHaveLength(1);
    expect(model.turns[1]?.fillerMarks).toHaveLength(1);
    expect(model.turns[0]?.paceDrift).toEqual([{ turnIndex: 0, start: 0, end: 10, direction: 'fast' }]);
    expect(model.turns[0]?.durationSec).toBe(31);
    expect(model.turns[1]?.durationSec).toBe(12);
  });
});
