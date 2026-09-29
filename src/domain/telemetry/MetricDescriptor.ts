import { DomainError } from "../shared/DomainError.ts";
import type { MetricKind } from "./MetricKind.ts";

const NAME = /^pi_runtime_[a-z_]+$/;
const LABEL = /^[a-z][a-z_]*$/;

// Una métrica del catálogo: nombre (el mismo en Prometheus y en OTLP), tipo, ayuda y
// nombres de label (ordenados). `integer` distingue los contadores enteros (asInt en
// OTLP) del coste, que es decimal (asDouble).
export class MetricDescriptor {
  readonly name: string; readonly kind: MetricKind; readonly help: string; readonly labelNames: readonly string[]; readonly integer: boolean;
  private constructor(name: string, kind: MetricKind, help: string, labelNames: string[], integer: boolean) {
    this.name = name; this.kind = kind; this.help = help; this.labelNames = [...labelNames].sort(); this.integer = integer;
  }

  static counter(name: string, help: string, labelNames: string[], integer = true): MetricDescriptor {
    return MetricDescriptor.#of(name, "counter", help, labelNames, integer);
  }
  static histogram(name: string, help: string, labelNames: string[]): MetricDescriptor {
    return MetricDescriptor.#of(name, "histogram", help, labelNames, false);
  }

  static #of(name: string, kind: MetricKind, help: string, labelNames: string[], integer: boolean): MetricDescriptor {
    if (!NAME.test(name)) throw DomainError.because(`invalid metric name ${name}`);
    if (kind === "counter" && !name.endsWith("_total")) throw DomainError.because(`counter ${name} must end in _total`);
    if (labelNames.some((l) => !LABEL.test(l) || l === "le")) throw DomainError.because(`invalid label names for ${name}`);
    return new MetricDescriptor(name, kind, help, labelNames, integer);
  }
}
