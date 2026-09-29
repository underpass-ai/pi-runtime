import { createHash } from "node:crypto";
import type { EventId } from "../events/EventId.ts";

// PRNG determinista (sfc32) sembrado con sha256("pi-runtime.thompson:" + event_id) de
// tools.selected (spec §2): la misma decisión reproduce el mismo muestreo. Incluye las
// variables que necesita Thompson: normal (Box-Muller), gamma (Marsaglia-Tsang, con el
// impulso u^(1/a) para a < 1) y beta.
export class SeededRandom {
  #a: number; #b: number; #c: number; #d: number;
  private constructor(a: number, b: number, c: number, d: number) {
    this.#a = a; this.#b = b; this.#c = c; this.#d = d;
    for (let i = 0; i < 12; i++) this.next();
  }

  static from(seed: EventId): SeededRandom {
    const h = createHash("sha256").update(`pi-runtime.thompson:${seed.value}`).digest("hex");
    const word = (i: number) => parseInt(h.slice(i * 8, i * 8 + 8), 16) | 0;
    return new SeededRandom(word(0), word(1), word(2), word(3));
  }

  // Uniforme en [0, 1).
  next(): number {
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  normal(): number {
    const u1 = 1 - this.next(); const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  gamma(shape: number): number {
    if (shape < 1) return this.gamma(shape + 1) * (1 - this.next()) ** (1 / shape);
    const d = shape - 1 / 3; const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = this.normal(); const base = 1 + c * x;
      if (base <= 0) continue;
      const v = base ** 3; const u = 1 - this.next();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  beta(alpha: number, beta: number): number {
    const x = this.gamma(alpha); const y = this.gamma(beta);
    return x + y === 0 ? 0.5 : x / (x + y);
  }
}
