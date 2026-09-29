const BASE_MS = 5_000;
const CAP_MS = 300_000;

// Retroceso de un spool huérfano que no se pudo adoptar: 5 s tras el primer
// fallo, doblando en cada fallo seguido, con tope de 5 min. Inmutable.
export class SpoolRetryBackoff {
  readonly #failures: number; readonly #failedAtMs: number;
  private constructor(failures: number, failedAtMs: number) { this.#failures = failures; this.#failedAtMs = failedAtMs; }

  static first(nowMs: number): SpoolRetryBackoff { return new SpoolRetryBackoff(1, nowMs); }
  failedAgain(nowMs: number): SpoolRetryBackoff { return new SpoolRetryBackoff(this.#failures + 1, nowMs); }

  failures(): number { return this.#failures; }
  failedAtMs(): number { return this.#failedAtMs; }
  nextAttemptMs(): number { return this.#failedAtMs + Math.min(CAP_MS, BASE_MS * 2 ** Math.min(this.#failures - 1, 16)); }
  isDue(nowMs: number): boolean { return nowMs >= this.nextAttemptMs(); }
}
