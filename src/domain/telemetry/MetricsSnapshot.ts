import { MetricCatalog } from "./MetricCatalog.ts";
import type { MetricDescriptor } from "./MetricDescriptor.ts";
import type { MetricPoint } from "./MetricPoint.ts";

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Todas las series acumuladas en un instante, en orden estable: catálogo y labels canónicos.
export class MetricsSnapshot {
  readonly #points: readonly MetricPoint[];
  private constructor(points: MetricPoint[]) { this.#points = points; }

  static of(points: MetricPoint[]): MetricsSnapshot {
    const order = (p: MetricPoint) => MetricCatalog.ALL.indexOf(p.key.descriptor);
    return new MetricsSnapshot([...points].sort((a, b) => order(a) - order(b) || byText(a.key.labels.text, b.key.labels.text)));
  }

  points(): MetricPoint[] { return [...this.#points]; }
  isEmpty(): boolean { return this.#points.length === 0; }
  byDescriptor(): { descriptor: MetricDescriptor; points: MetricPoint[] }[] {
    return MetricCatalog.ALL.map((descriptor) => ({ descriptor, points: this.#points.filter((p) => p.key.descriptor === descriptor) })).filter((g) => g.points.length > 0);
  }
}
