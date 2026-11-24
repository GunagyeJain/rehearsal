/** Thrown by service stubs whose logic lands in a later phase of spec/build-plan.md. */
export class NotImplementedError extends Error {
  constructor(what: string, phase: number) {
    super(`${what} is not implemented yet (Phase ${phase})`);
    this.name = 'NotImplementedError';
  }
}
