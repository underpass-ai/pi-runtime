import { DomainError } from "../shared/DomainError.ts";
import { LabelValue } from "./LabelValue.ts";

const NAME = /^[a-z][a-z_]*$/;

// Labels canónicos: ordenados por nombre, `k=v` unidos con `,`. Como LabelValue
// nunca contiene `,` ni `=`, el texto se puede volver a leer sin ambigüedad.
export class MetricLabels {
  readonly #entries: readonly [string, LabelValue][];
  private constructor(entries: [string, LabelValue][]) { this.#entries = entries; }
  static readonly NONE = new MetricLabels([]);

  static of(values: Record<string, LabelValue>): MetricLabels {
    return new MetricLabels(Object.keys(values).sort().map((k) => {
      if (!NAME.test(k)) throw DomainError.because(`invalid label name ${k}`);
      return [k, values[k]];
    }));
  }

  static parse(text: string): MetricLabels {
    if (typeof text !== "string") throw DomainError.because("labels must be a string");
    if (text === "") return MetricLabels.NONE;
    return MetricLabels.of(Object.fromEntries(text.split(",").map((pair) => {
      const i = pair.indexOf("=");
      if (i < 1) throw DomainError.because("malformed canonical labels");
      return [pair.slice(0, i), LabelValue.of(pair.slice(i + 1))];
    })));
  }

  get text(): string { return this.#entries.map(([k, v]) => `${k}=${v.value}`).join(","); }
  entries(): [string, string][] { return this.#entries.map(([k, v]) => [k, v.value]); }
  names(): string[] { return this.#entries.map(([k]) => k); }
  get(name: string): string | null { return this.#entries.find(([k]) => k === name)?.[1].value ?? null; }
  equals(o: MetricLabels): boolean { return o.text === this.text; }
}
