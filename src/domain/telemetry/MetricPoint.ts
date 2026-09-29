import { DomainError } from "../shared/DomainError.ts";
import type { HistogramValue } from "./HistogramValue.ts";
import type { MetricKey } from "./MetricKey.ts";

// Una serie con su valor acumulado: un número (contador) o un histograma.
export class MetricPoint {
  readonly key: MetricKey; readonly value: number | null; readonly histogram: HistogramValue | null;
  private constructor(key: MetricKey, value: number | null, histogram: HistogramValue | null) { this.key = key; this.value = value; this.histogram = histogram; }

  static counter(key: MetricKey, value: number): MetricPoint {
    if (key.descriptor.kind !== "counter" || typeof value !== "number" || !Number.isFinite(value) || value < 0) throw DomainError.because(`invalid counter value for ${key.text}`);
    return new MetricPoint(key, value, null);
  }
  static histogram(key: MetricKey, value: HistogramValue): MetricPoint {
    if (key.descriptor.kind !== "histogram") throw DomainError.because(`${key.descriptor.name} is not a histogram`);
    return new MetricPoint(key, null, value);
  }
}
