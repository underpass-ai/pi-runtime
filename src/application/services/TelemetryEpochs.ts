import { TelemetryEpoch } from "../../domain/telemetry/TelemetryEpoch.ts";
import type { Clock } from "../ports/Clock.ts";
import type { TelemetryEpochStore } from "../ports/TelemetryEpochStore.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";

// Se fija la primera vez que se pide y se conserva. Una versión distinta de
// `telemetry_metrics` (el runner la reconstruye) o un `events rebuild telemetry_metrics`
// lo reinician: OTLP lo ve como un reinicio de contador (otro startTimeUnixNano).
export class TelemetryEpochs {
  readonly #store: TelemetryEpochStore; readonly #clock: Clock;
  constructor(store: TelemetryEpochStore, clock: Clock) { this.#store = store; this.#clock = clock; }

  current(): TelemetryEpoch {
    const epoch = this.#store.read();
    return epoch !== null && epoch.projectionVersion === TelemetryMetricsProjection.VERSION ? epoch : this.restart();
  }

  restart(): TelemetryEpoch {
    const epoch = TelemetryEpoch.of(this.#clock.now(), TelemetryMetricsProjection.VERSION);
    this.#store.write(epoch);
    return epoch;
  }
}
