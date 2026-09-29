import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StoredEvent } from "../../domain/events/StoredEvent.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { HistogramValue } from "../../domain/telemetry/HistogramValue.ts";
import { MetricKey } from "../../domain/telemetry/MetricKey.ts";
import { MetricPoint } from "../../domain/telemetry/MetricPoint.ts";
import { MetricsSnapshot } from "../../domain/telemetry/MetricsSnapshot.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";
import { ProjectionState } from "../services/ProjectionState.ts";

// Snapshot de las métricas acumuladas. Sin sesión, del estado de `telemetry_metrics`;
// con sesión, reproduciendo en memoria sólo su stream (las métricas no llevan label de
// sesión: así no crece la cardinalidad).
export class ReadTelemetryMetrics {
  readonly #events: EventStore; readonly #store: ProjectionStore;
  constructor(events: EventStore, store: ProjectionStore) { this.#events = events; this.#store = store; }

  execute(session?: SessionId): MetricsSnapshot {
    const state = session === undefined ? this.#store.load(TelemetryMetricsProjection.NAME) : this.#replay(session);
    const points: MetricPoint[] = [];
    for (const [raw, value] of state) {
      const key = MetricKey.parse(raw);
      if (key === null) continue;
      points.push(key.descriptor.kind === "histogram" ? MetricPoint.histogram(key, HistogramValue.fromJson(value)) : MetricPoint.counter(key, Number(value)));
    }
    return MetricsSnapshot.of(points);
  }

  #replay(session: SessionId): Map<string, unknown> {
    const projection = new TelemetryMetricsProjection(); const state = new ProjectionState(new Map());
    this.#events.readStream(StreamId.session(session)).forEach((r, i) => { projection.apply(state, StoredEvent.of(GlobalPosition.of(i + 1), r)); state.accept(); });
    return new Map(state.keys().map((k) => [k, state.get<unknown>(k)]));
  }
}
