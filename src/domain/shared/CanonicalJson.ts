import { DomainError } from "./DomainError.ts";

export class CanonicalJson {
  readonly #text: string;
  private constructor(text: string) { this.#text = text; }

  static of(value: unknown): CanonicalJson { return new CanonicalJson(JSON.stringify(CanonicalJson.#normalize(value, "$"))); }

  static parse(text: string): CanonicalJson {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw DomainError.because("payload is not valid JSON"); }
    return CanonicalJson.of(value);
  }

  get text(): string { return this.#text; }
  toValue(): unknown { return JSON.parse(this.#text); }
  equals(o: CanonicalJson): boolean { return o.text === this.#text; }

  static #normalize(v: unknown, path: string): unknown {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw DomainError.because(`non-finite number at ${path}`);
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => CanonicalJson.#normalize(x, `${path}[${i}]`));
    if (typeof v === "object") {
      // Sólo objetos planos: Date, Map, Set o instancias de clase se
      // serializarían en silencio como {} (o como otra cosa) y perderían datos.
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw DomainError.because(`unsupported JSON value at ${path}: not a plain object`);
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, CanonicalJson.#normalize(o[k], `${path}.${k}`)]));
    }
    throw DomainError.because(`unsupported JSON value at ${path}`);
  }
}
