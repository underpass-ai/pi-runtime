function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]));
  return v;
}

export class JsonSchema {
  readonly #schema: Record<string, unknown>;
  private constructor(s: Record<string, unknown>) { this.#schema = s; }
  static of(schema: Record<string, unknown>): JsonSchema { return new JsonSchema(structuredClone(schema)); }
  canonical(): string { return JSON.stringify(canonicalize(this.#schema)); }
  toJson(): Record<string, unknown> { return structuredClone(this.#schema); }
}
