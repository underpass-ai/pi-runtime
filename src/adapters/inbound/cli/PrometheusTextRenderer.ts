import { HistogramValue } from "../../../domain/telemetry/HistogramValue.ts";
import type { MetricsSnapshot } from "../../../domain/telemetry/MetricsSnapshot.ts";

const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (entries: [string, string][]) => (entries.length === 0 ? "" : `{${entries.map(([k, v]) => `${k}="${escape(v)}"`).join(",")}}`);

// Formato de exposición de Prometheus (texto 0.0.4): # HELP, # TYPE, labels ordenados
// por nombre (y `le` al final en los cubos), histograma con _bucket acumulado, _sum y _count.
export class PrometheusTextRenderer {
  render(snapshot: MetricsSnapshot): string {
    const lines: string[] = [];
    for (const { descriptor: d, points } of snapshot.byDescriptor()) {
      lines.push(`# HELP ${d.name} ${d.help}`, `# TYPE ${d.name} ${d.kind}`);
      for (const p of points) {
        const base = p.key.labels.entries();
        if (p.histogram === null) { lines.push(`${d.name}${labels(base)} ${p.value}`); continue; }
        const cumulative = p.histogram.cumulative();
        HistogramValue.BOUNDS.forEach((bound, i) => lines.push(`${d.name}_bucket${labels([...base, ["le", String(bound)]])} ${cumulative[i]}`));
        lines.push(`${d.name}_bucket${labels([...base, ["le", "+Inf"]])} ${p.histogram.count}`);
        lines.push(`${d.name}_sum${labels(base)} ${p.histogram.sum}`, `${d.name}_count${labels(base)} ${p.histogram.count}`);
      }
    }
    return lines.join("\n");
  }
}
