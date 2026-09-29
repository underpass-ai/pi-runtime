import { DomainError } from "../shared/DomainError.ts";

type Observation = readonly [reward: number, weight: number];

// Beta-SWTS (spec §2): las últimas 200 observaciones (recompensa 0|1, peso en (0, 1]) de un
// par (contexto, tool). Una observación suma w·r a α y w·(1−r) a β sobre el prior neutral
// Beta(1, 1). El prior de tool_stats suma a α los éxitos ya registrados de la tool en el
// proyecto, hasta 5 (spec §2).
export class SlidingBeta {
  static readonly WINDOW = 200;
  static readonly MAX_PRIOR_SUCCESSES = 5;
  readonly #observations: readonly Observation[];
  private constructor(observations: readonly Observation[]) { this.#observations = observations; }
  static readonly EMPTY = new SlidingBeta([]);

  static fromJson(raw: unknown): SlidingBeta {
    if (!Array.isArray(raw)) throw DomainError.because("bandit observations must be an array");
    return raw.reduce((beta: SlidingBeta, o: unknown) => {
      if (!Array.isArray(o) || o.length !== 2) throw DomainError.because("a bandit observation is [reward, weight]");
      return beta.observe(o[0] as number, o[1] as number);
    }, SlidingBeta.EMPTY);
  }

  observe(reward: number, weight: number): SlidingBeta {
    if (reward !== 0 && reward !== 1) throw DomainError.because(`reward must be 0 or 1, got ${reward}`);
    if (typeof weight !== "number" || !(weight > 0 && weight <= 1)) throw DomainError.because(`weight must be in (0, 1], got ${weight}`);
    return new SlidingBeta([...this.#observations, [reward, weight] as const].slice(-SlidingBeta.WINDOW));
  }

  get n(): number { return this.#observations.length; }
  alpha(priorSuccesses = 0): number {
    const boost = Math.min(Math.max(0, Number.isFinite(priorSuccesses) ? priorSuccesses : 0), SlidingBeta.MAX_PRIOR_SUCCESSES);
    return 1 + boost + this.#observations.reduce((s, [r, w]) => s + w * r, 0);
  }
  beta(): number { return 1 + this.#observations.reduce((s, [r, w]) => s + w * (1 - r), 0); }
  mean(priorSuccesses = 0): number { const a = this.alpha(priorSuccesses); return a / (a + this.beta()); }
  toJson(): [number, number][] { return this.#observations.map(([r, w]) => [r, w]); }
}
