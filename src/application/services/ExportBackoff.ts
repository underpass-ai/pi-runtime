const BASE_MS = 1_000;
const CAP_MS = 300_000;

// Espera progresiva del exportador OTLP tras un fallo reintentable: 1 s, doblando en
// cada fallo seguido, con tope de 5 min. Inmutable.
export class ExportBackoff {
  readonly #failures: number; readonly #failedAtMs: number;
  private constructor(failures: number, failedAtMs: number) { this.#failures = failures; this.#failedAtMs = failedAtMs; }

  static first(nowMs: number): ExportBackoff { return new ExportBackoff(1, nowMs); }
  failedAgain(nowMs: number): ExportBackoff { return new ExportBackoff(this.#failures + 1, nowMs); }

  failures(): number { return this.#failures; }
  nextAttemptMs(): number { return this.#failedAtMs + Math.min(CAP_MS, BASE_MS * 2 ** Math.min(this.#failures - 1, 16)); }
  isDue(nowMs: number): boolean { return nowMs >= this.nextAttemptMs(); }
}
