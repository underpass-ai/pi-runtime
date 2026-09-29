import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { MetricsSnapshot } from "../../domain/telemetry/MetricsSnapshot.ts";
import type { Span } from "../../domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../domain/telemetry/TelemetryResource.ts";

// Destino de la telemetría (OTLP/HTTP en producción). Nunca lanza: un fallo es un ExportResult.
export interface TelemetrySink {
  sendSpans(resource: TelemetryResource, spans: Span[]): Promise<ExportResult>;
  sendMetrics(resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult>;
}
