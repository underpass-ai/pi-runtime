import type { TelemetrySink } from "../../../application/ports/TelemetrySink.ts";
import type { Timestamp } from "../../../domain/events/Timestamp.ts";
import { ExportResult } from "../../../domain/telemetry/ExportResult.ts";
import type { MetricsSnapshot } from "../../../domain/telemetry/MetricsSnapshot.ts";
import type { OtlpSettings } from "../../../domain/telemetry/OtlpSettings.ts";
import type { Span } from "../../../domain/telemetry/Span.ts";
import type { TelemetryResource } from "../../../domain/telemetry/TelemetryResource.ts";
import type { OtlpJsonMapper } from "./OtlpJsonMapper.ts";

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "manual" }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

// POST OTLP/HTTP JSON con `fetch` nativo y OTEL_EXPORTER_OTLP_TIMEOUT. Nunca lanza. El
// cuerpo de la respuesta se descarta sin leerlo en ningún log.
export class OtlpHttpTelemetrySink implements TelemetrySink {
  readonly #settings: OtlpSettings; readonly #mapper: OtlpJsonMapper; readonly #fetch: Fetch;
  constructor(settings: OtlpSettings, mapper: OtlpJsonMapper, fetchImpl: Fetch = (url, init) => fetch(url, init)) {
    this.#settings = settings; this.#mapper = mapper; this.#fetch = fetchImpl;
  }

  sendSpans(resource: TelemetryResource, spans: Span[]): Promise<ExportResult> { return this.#post("traces", this.#mapper.traces(resource, spans)); }
  sendMetrics(resource: TelemetryResource, snapshot: MetricsSnapshot, start: Timestamp, at: Timestamp): Promise<ExportResult> {
    return this.#post("metrics", this.#mapper.metrics(resource, snapshot, start, at));
  }

  async #post(kind: "traces" | "metrics", body: Record<string, unknown>): Promise<ExportResult> {
    try {
      const res = await this.#fetch(this.#settings.endpoint.signalUrl(kind), {
        method: "POST", headers: { ...this.#settings.headers.toRecord(), "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.#settings.timeoutMs),
        // Nunca seguir una redirección: reenviaría cuerpo y cabeceras a otro origen (o a
        // http). Un 3xx acaba como `rejected` (http 3xx) vía ExportResult.ofStatus.
        redirect: "manual",
      });
      await res.arrayBuffer().catch(() => undefined);
      return ExportResult.ofStatus(res.status);
    } catch (e) {
      return ExportResult.retryable(OtlpHttpTelemetrySink.#reason(e));
    }
  }

  // Sólo un código: el mensaje de fetch puede nombrar el host del endpoint.
  static #reason(e: unknown): string {
    const err = e as { name?: unknown; cause?: { code?: unknown } } | null;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
    const code = err?.cause?.code;
    return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? `network ${code}` : "network error";
  }
}
