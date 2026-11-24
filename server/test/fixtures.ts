import type { ScenarioInput } from '@rehearsal/shared';

export function validScenario(id = 'test-scenario'): ScenarioInput {
  return {
    id,
    track: 'fundamentals',
    title: 'Test scenario',
    description: 'A scenario used by server tests.',
    difficulty: 1,
    brief: { scene: 'A quiet room.', yourGoal: 'Introduce yourself.' },
    turns: [
      {
        index: 0,
        speaker: 'ai',
        persona: 'A friendly interviewer.',
        generate: 'Ask the user to introduce themselves.',
        userResponse: { maxSeconds: 60, minSeconds: 10, silenceStopSeconds: 4 },
      },
    ],
    rubric: {
      objective: [{ id: 'pace', label: 'Pace', metric: 'wpm', op: 'between', value: [110, 170] }],
      judged: [{ id: 'structure', label: 'Structure', criterion: 'Has a clear beginning and end.' }],
    },
    criteriaDisplay: ['Steady pace', 'Clear structure'],
  };
}
