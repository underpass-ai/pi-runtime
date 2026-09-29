import { DomainError } from "../shared/DomainError.ts";
import { MetricCatalog } from "./MetricCatalog.ts";
import type { MetricDescriptor } from "./MetricDescriptor.ts";
import { MetricLabels } from "./MetricLabels.ts";

const PREFIX = { counter: "counter", histogram: "hist" } as const;

// Clave de una serie en projection_state: `counter|<nombre>|<labels>` o `hist|<nombre>|<labels>`.
export class MetricKey {
  readonly descriptor: MetricDescriptor; readonly labels: MetricLabels;
  private constructor(descriptor: MetricDescriptor, labels: MetricLabels) { this.descriptor = descriptor; this.labels = labels; }

  static of(descriptor: MetricDescriptor, labels: MetricLabels): MetricKey {
    if (labels.names().join(",") !== descriptor.labelNames.join(",")) throw DomainError.because(`labels of ${descriptor.name} must be ${descriptor.labelNames.join(",")}`);
    return new MetricKey(descriptor, labels);
  }

  // null para las claves que no son series (el estado auxiliar de la proyección) o de métricas desconocidas.
  static parse(raw: string): MetricKey | null {
    const parts = raw.split("|");
    if (parts.length !== 3) return null;
    const descriptor = MetricCatalog.find(parts[1]);
    if (descriptor === null || PREFIX[descriptor.kind] !== parts[0]) return null;
    try { return MetricKey.of(descriptor, MetricLabels.parse(parts[2])); } catch { return null; }
  }

  get text(): string { return `${PREFIX[this.descriptor.kind]}|${this.descriptor.name}|${this.labels.text}`; }
}
