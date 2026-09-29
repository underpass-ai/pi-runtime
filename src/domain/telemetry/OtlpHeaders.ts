import { DomainError } from "../shared/DomainError.ts";
import { OtelKeyValueList } from "./OtelKeyValueList.ts";

const NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

// OTEL_EXPORTER_OTLP_HEADERS. Sólo los nombres se pueden mostrar (doctor); los valores
// sólo salen hacia el adaptador HTTP. toString y toJSON enseñan nombres, nunca valores.
// content-type lo fija el exportador y se ignora aquí.
export class OtlpHeaders {
  readonly #values: ReadonlyMap<string, string>;
  private constructor(values: Map<string, string>) { this.#values = values; }
  static readonly NONE = new OtlpHeaders(new Map());

  static parse(raw: string): OtlpHeaders {
    const values = new Map<string, string>();
    for (const [key, value] of OtelKeyValueList.parse(raw).entries()) {
      if (!NAME.test(key)) throw DomainError.because("OTEL_EXPORTER_OTLP_HEADERS has an invalid header name");
      const name = key.toLowerCase();
      // Lo que fetch rechazaría (NUL, saltos de línea, fuera de Latin-1) se detecta aquí, no en cada envío.
      if (/[\0\r\n]|[^\x00-\xff]/.test(value)) throw DomainError.because(`OTEL_EXPORTER_OTLP_HEADERS value for ${name} has a character not allowed in HTTP headers`);
      if (name !== "content-type") values.set(name, value);
    }
    return new OtlpHeaders(values);
  }

  names(): string[] { return [...this.#values.keys()].sort(); }
  toRecord(): Record<string, string> { return Object.fromEntries(this.#values); }
  toString(): string { return `OtlpHeaders(${this.names().join(", ")})`; }
  toJSON(): string[] { return this.names(); }
}
