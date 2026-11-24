import type { UserInputValues } from '@rehearsal/shared';
import { fetchTts, generateTurn, startAttempt } from './scenarioApi';

/** A line the AI will speak, with its audio when TTS succeeded (null: show it as text). */
export interface PreparedLine {
  index: number;
  text: string;
  audio: ArrayBuffer | null;
}

function inputsKey(values: UserInputValues): string {
  return JSON.stringify(Object.keys(values).sort().map((k) => [k, values[k]]));
}

/**
 * One attempt in progress, shared between the brief (which starts it so turn 0 is ready) and
 * the live screen. Lives in memory only: audio buffers are never written to storage.
 * Failed requests are not cached, so a retry issues a fresh request.
 */
export class AttemptSession {
  readonly scenarioId: string;
  readonly userInputs: UserInputValues;
  readonly key: string;
  private hasBegun = false;
  private started: Promise<{ attemptId: string; firstLine: string }> | null = null;
  private lines = new Map<number, Promise<PreparedLine>>();

  constructor(scenarioId: string, userInputs: UserInputValues) {
    this.scenarioId = scenarioId;
    this.userInputs = userInputs;
    this.key = `${scenarioId}:${inputsKey(userInputs)}`;
  }

  /** True once Begin is pressed; a later visit to the brief starts a new attempt. */
  get begun(): boolean {
    return this.hasBegun;
  }

  markBegun(): void {
    this.hasBegun = true;
  }

  private start(): Promise<{ attemptId: string; firstLine: string }> {
    if (!this.started) {
      const request = startAttempt(this.scenarioId, this.userInputs).then((r) => ({
        attemptId: r.attemptId,
        firstLine: r.turn.text,
      }));
      this.started = request;
      request.catch(() => {
        if (this.started === request) this.started = null;
      });
    }
    return this.started;
  }

  attemptId(): Promise<string> {
    return this.start().then((s) => s.attemptId);
  }

  /** Generate (or reuse) the line for a turn and fetch its audio. */
  prepareLine(index: number): Promise<PreparedLine> {
    const cached = this.lines.get(index);
    if (cached) return cached;
    const request = (async (): Promise<PreparedLine> => {
      const { attemptId, firstLine } = await this.start();
      const text = index === 0 ? firstLine : (await generateTurn(attemptId, index)).text;
      const audio = await fetchTts({ attemptId, turnIndex: index }).catch(() => null);
      return { index, text, audio };
    })();
    this.lines.set(index, request);
    request.catch(() => {
      if (this.lines.get(index) === request) this.lines.delete(index);
    });
    return request;
  }

  /** Start preparing a line without waiting; errors surface when the line is awaited. */
  prefetchLine(index: number): void {
    this.prepareLine(index).catch(() => undefined);
  }
}

let current: AttemptSession | null = null;

/** Reuse the open session for the same scenario and inputs unless it has already begun. */
export function openAttemptSession(scenarioId: string, userInputs: UserInputValues): AttemptSession {
  const candidate = new AttemptSession(scenarioId, userInputs);
  if (current && !current.begun && current.key === candidate.key) return current;
  current = candidate;
  return candidate;
}

export function getAttemptSession(scenarioId: string): AttemptSession | null {
  return current && current.scenarioId === scenarioId ? current : null;
}

export function closeAttemptSession(session: AttemptSession): void {
  if (current === session) current = null;
}

/** Drop any open session. Called on sign-out so the next account never reuses this one's attempt. */
export function resetAttemptSessions(): void {
  current = null;
}
