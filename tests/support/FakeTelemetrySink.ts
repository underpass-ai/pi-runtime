import type { TelemetrySink } from "../../src/application/ports/TelemetrySink.ts";
import type { Timestamp } from "../../src/domain/events/Timestamp.ts";
import { ExportResult } from "../../src/domain/telemetry/ExportResult.ts";
import type { MetricsSnapshot } from "../../src/domain/telemetry/MetricsSnapshot.ts";
import type { Span } from "../../src/domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../src/domain/telemetry/TelemetryResource.ts";

// Guarda lo enviado y responde con `results` en orden (ok cuando se agotan).
export class FakeTelemetrySink implements TelemetrySink {
  readonly batches: Span[][] = [];
  readonly metrics: { snapshot: MetricsSnapshot; start: Timestamp; at: Timestamp }[] = [];
  readonly results: ExportResult[] = [];
  async sendSpans(_resource: TelemetryResource, spans: Span[]): Promise<ExportResult> { this.batches.push(spans); return this.results.shift() ?? ExportResult.ok(); }
  async sendMetrics(_resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult> {
    this.metrics.push({ snapshot, start, at });
    return this.results.shift() ?? ExportResult.ok();
  }
}
