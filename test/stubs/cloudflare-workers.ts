// Minimal stand-in for the Workers runtime module in Node tests.
export class WorkerEntrypoint {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown,
  ) {}
}
