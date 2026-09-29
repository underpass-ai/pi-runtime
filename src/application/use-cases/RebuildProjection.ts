import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";
import type { ProjectionRunner } from "../services/ProjectionRunner.ts";
import type { TelemetryEpochs } from "../services/TelemetryEpochs.ts";
import { TraceExport } from "./TraceExport.ts";

// `otlp_traces` no es una proyección del runner: reconstruirla es volver su cursor a 0
// para que el exportador del host reexporte (con los mismos ids). Reconstruir
// `telemetry_metrics` reinicia además el inicio del acumulado.
export class RebuildProjection {
  readonly #runner: ProjectionRunner; readonly #store: ProjectionStore | null; readonly #epochs: TelemetryEpochs | null;
  constructor(runner: ProjectionRunner, store: ProjectionStore | null = null, epochs: TelemetryEpochs | null = null) {
    this.#runner = runner; this.#store = store; this.#epochs = epochs;
  }

  execute(name: ProjectionName): void {
    if (name.equals(TraceExport.NAME) && this.#store !== null) { this.#store.reset(TraceExport.NAME, TraceExport.VERSION); return; }
    this.#runner.rebuild(name);
    if (name.equals(TelemetryMetricsProjection.NAME)) this.#epochs?.restart();
  }
}
