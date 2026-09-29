import { DomainError } from "../shared/DomainError.ts";

const KEY = /^[a-z][a-z0-9_.]*$/;
const MAX_TEXT = 256;
type Value = string | number | boolean;

// Atributos de span, de evento o de recurso: sólo metadatos (nombres de tool, modelo,
// estados, contadores y bytes), nunca texto libre de Pi. Ordenados por clave; los
// null/undefined y los números no finitos se descartan; los textos se recortan.
export class SpanAttributes {
  readonly #values: ReadonlyMap<string, Value>;
  private constructor(values: Map<string, Value>) { this.#values = values; }
  static readonly NONE = new SpanAttributes(new Map());

  static of(values: Record<string, Value | null | undefined>): SpanAttributes {
    const out = new Map<string, Value>();
    for (const key of Object.keys(values).sort()) {
      if (!KEY.test(key)) throw DomainError.because(`invalid attribute key ${key}`);
      const v = values[key];
      if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) continue;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw DomainError.because(`invalid attribute value for ${key}`);
      out.set(key, typeof v === "string" ? v.slice(0, MAX_TEXT) : v);
    }
    return new SpanAttributes(out);
  }

  get(key: string): Value | null { return this.#values.get(key) ?? null; }
  entries(): [string, Value][] { return [...this.#values]; }
  toRecord(): Record<string, Value> { return Object.fromEntries(this.#values); }
}
