import { DomainError } from "../shared/DomainError.ts";

// Formato de OTEL_EXPORTER_OTLP_HEADERS y OTEL_RESOURCE_ATTRIBUTES: "k=v,k2=v2", con los
// valores percent-encoded. Los errores nunca repiten la entrada: puede llevar credenciales.
export class OtelKeyValueList {
  readonly #pairs: ReadonlyMap<string, string>;
  private constructor(pairs: Map<string, string>) { this.#pairs = pairs; }
  static readonly EMPTY = new OtelKeyValueList(new Map());

  static parse(raw: string): OtelKeyValueList {
    if (typeof raw !== "string") throw DomainError.because("key=value list must be a string");
    const pairs = new Map<string, string>();
    raw.split(",").forEach((part, i) => {
      if (part.trim() === "") return;
      const eq = part.indexOf("=");
      const key = eq < 0 ? "" : part.slice(0, eq).trim();
      if (key === "") throw DomainError.because(`malformed key=value list at entry ${i + 1}`);
      let value: string;
      try { value = decodeURIComponent(part.slice(eq + 1).trim()); } catch { throw DomainError.because(`malformed percent-encoding at entry ${i + 1}`); }
      pairs.set(key, value);
    });
    return new OtelKeyValueList(pairs);
  }

  entries(): [string, string][] { return [...this.#pairs]; }
  keys(): string[] { return [...this.#pairs.keys()]; }
  get(key: string): string | null { return this.#pairs.get(key) ?? null; }
  isEmpty(): boolean { return this.#pairs.size === 0; }
}
