import type { Timestamp } from "../../../domain/events/Timestamp.ts";
import { HistogramValue } from "../../../domain/telemetry/HistogramValue.ts";
import type { MetricsSnapshot } from "../../../domain/telemetry/MetricsSnapshot.ts";
import type { Span } from "../../../domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../../domain/telemetry/TelemetryResource.ts";

type AnyValue = { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };
type KeyValue = { key: string; value: AnyValue };

const SCOPE = "pi-runtime";
const SPAN_KIND_INTERNAL = 1;
const STATUS_CODE_UNSET = 0;
const STATUS_CODE_ERROR = 2;
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
// Claves decimales; cualquier otro número (bytes, tokens, duraciones, códigos) es entero.
// El tipo depende de la clave y no del valor: un coste de 1 sigue siendo double.
const DOUBLE_KEYS = new Set(["pi_runtime.cost"]);
const nanos = (t: Timestamp) => (BigInt(t.epochMs()) * 1_000_000n).toString();

// ExportTraceServiceRequest y ExportMetricsServiceRequest en OTLP/JSON (mapeo JSON de
// proto3): traceId/spanId en hex, enteros de 64 bits y tiempos como texto, enums como
// número. Las métricas llevan el nombre exacto del catálogo y `unit` vacía, para que un
// receptor Prometheus no añada sufijos y los nombres coincidan con reglas y dashboard.
export class OtlpJsonMapper {
  readonly #version: string;
  constructor(scopeVersion: string) { this.#version = scopeVersion; }

  traces(resource: TelemetryResource, spans: Span[]): Record<string, unknown> {
    return { resourceSpans: [{
      resource: { attributes: OtlpJsonMapper.#attributes(resource.attributes().entries()) },
      scopeSpans: [{ scope: { name: SCOPE, version: this.#version }, spans: spans.map((s) => ({
        traceId: s.traceId.value, spanId: s.spanId.value, ...(s.parentId === null ? {} : { parentSpanId: s.parentId.value }),
        name: s.name, kind: SPAN_KIND_INTERNAL, startTimeUnixNano: nanos(s.start), endTimeUnixNano: nanos(s.end),
        attributes: OtlpJsonMapper.#attributes(s.attributes.entries()),
        events: s.events.map((e) => ({ timeUnixNano: nanos(e.at), name: e.name, attributes: OtlpJsonMapper.#attributes(e.attributes.entries()) })),
        status: { code: s.status.isError() ? STATUS_CODE_ERROR : STATUS_CODE_UNSET },
      })) }],
    }] };
  }

  metrics(resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Record<string, unknown> {
    const point = (labels: [string, string][]) => ({ attributes: labels.map(([key, v]) => ({ key, value: { stringValue: v } })), startTimeUnixNano: nanos(start), timeUnixNano: nanos(at) });
    return { resourceMetrics: [{
      resource: { attributes: OtlpJsonMapper.#attributes(resource.attributes().entries()) },
      scopeMetrics: [{ scope: { name: SCOPE, version: this.#version }, metrics: snapshot.byDescriptor().map(({ descriptor: d, points }) => d.kind === "histogram"
        ? { name: d.name, description: d.help, unit: "", histogram: { aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE, dataPoints: points.map((p) => {
            const h = p.histogram as HistogramValue;
            return { ...point(p.key.labels.entries()), count: String(h.count), sum: h.sum, bucketCounts: h.bucketCounts().map(String), explicitBounds: [...HistogramValue.BOUNDS] };
          }) } }
        : { name: d.name, description: d.help, unit: "", sum: { aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE, isMonotonic: true, dataPoints: points.map((p) => ({
            ...point(p.key.labels.entries()), ...(d.integer ? { asInt: String(Math.round(p.value ?? 0)) } : { asDouble: p.value ?? 0 }),
          })) } }) }],
    }] };
  }

  static #attributes(entries: [string, string | number | boolean][]): KeyValue[] {
    return entries.flatMap(([key, v]): KeyValue[] => {
      if (typeof v === "string") return [{ key, value: { stringValue: v } }];
      if (typeof v === "boolean") return [{ key, value: { boolValue: v } }];
      if (!Number.isFinite(v)) return [];
      return [{ key, value: DOUBLE_KEYS.has(key) ? { doubleValue: v } : { intValue: String(Math.round(v)) } }];
    });
  }
}
