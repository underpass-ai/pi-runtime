import { ExportResult } from "../../domain/telemetry/ExportResult.ts";
import type { TelemetryResource } from "../../domain/telemetry/TelemetryResource.ts";
import type { Clock } from "../ports/Clock.ts";
import type { TelemetrySink } from "../ports/TelemetrySink.ts";
import type { TelemetryEpochs } from "../services/TelemetryEpochs.ts";
import type { ReadTelemetryMetrics } from "./ReadTelemetryMetrics.ts";

// Snapshot acumulado (CUMULATIVE) desde el inicio del acumulado. Sin cola: si un envío
// falla, el siguiente snapshot lo cubre.
export class MetricsExport {
  readonly #read: ReadTelemetryMetrics; readonly #epochs: TelemetryEpochs; readonly #sink: TelemetrySink; readonly #resource: TelemetryResource; readonly #clock: Clock;
  constructor(read: ReadTelemetryMetrics, epochs: TelemetryEpochs, sink: TelemetrySink, resource: TelemetryResource, clock: Clock) {
    this.#read = read; this.#epochs = epochs; this.#sink = sink; this.#resource = resource; this.#clock = clock;
  }

  async execute(): Promise<ExportResult> {
    const epoch = this.#epochs.current();
    const snapshot = this.#read.execute();
    if (snapshot.isEmpty()) return ExportResult.ok();
    return this.#sink.sendMetrics(this.#resource, snapshot, epoch.start, this.#clock.now());
  }
}
