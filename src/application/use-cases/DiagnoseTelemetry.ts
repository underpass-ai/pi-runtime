import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { OtlpConfiguration } from "../../domain/telemetry/OtlpConfiguration.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { QualityKpisProjection } from "../projections/QualityKpisProjection.ts";
import { TelemetryMetricsProjection } from "../projections/TelemetryMetricsProjection.ts";
import { TraceExport } from "./TraceExport.ts";

const S = CheckSection.TELEMETRY;
const STALE_MS = 5 * 60_000;
const ok = (n: string, d: string) => Check.ok(S, CheckName.of(n), CheckDetail.of(d));
const warn = (n: string, d: string) => Check.warn(S, CheckName.of(n), CheckDetail.of(d));
const fail = (n: string, d: string) => Check.fail(S, CheckName.of(n), CheckDetail.of(d));

// Los dos checks de O1 en doctor. Nunca muestra el endpoint ni valores de cabeceras:
// sólo el tipo de endpoint (localhost o https) y los nombres de las cabeceras.
export class DiagnoseTelemetry {
  readonly #events: EventStore; readonly #store: ProjectionStore; readonly #configuration: OtlpConfiguration; readonly #clock: Clock;
  constructor(events: EventStore, store: ProjectionStore, configuration: OtlpConfiguration, clock: Clock) {
    this.#events = events; this.#store = store; this.#configuration = configuration; this.#clock = clock;
  }

  execute(): Check[] { return [this.#projections(), this.#exporter()]; }

  #projections(): Check {
    const last = this.#events.lastPosition().value;
    const problems: string[] = [];
    const list: Projection[] = [new TelemetryMetricsProjection(), new QualityKpisProjection()];
    for (const p of list) {
      const quarantined = this.#store.quarantined(p.name).length;
      if (quarantined > 0) problems.push(`${p.name.value} has ${quarantined} quarantined events`);
      if (last === 0) continue;
      const c = this.#store.cursor(p.name);
      if (c === null || c.version !== p.version) problems.push(`${p.name.value} not built yet`);
      else if (c.position.value < last) problems.push(`${p.name.value} at ${c.position.value}/${last}`);
    }
    if (problems.length > 0) return warn("telemetry projections", `${problems.join("; ")}; start pi in this project or run underpass events rebuild <projection>`);
    return ok("telemetry projections", last === 0 ? "no events yet" : "up to date");
  }

  #exporter(): Check {
    const c = this.#configuration;
    if (c.state === "disabled") return ok("otlp exporter", "disabled");
    if (c.settings === null) return fail("otlp exporter", `${c.problem ?? "invalid configuration"}; export is disabled`);
    const headers = c.settings.headers.names();
    const target = `${c.settings.endpoint.describe()} endpoint${headers.length > 0 ? `, headers: ${headers.join(", ")}` : ""}`;
    const cursor = this.#store.cursor(TraceExport.NAME);
    const from = cursor !== null && cursor.version === TraceExport.VERSION ? cursor.position : GlobalPosition.START;
    const [pending] = this.#events.readAll(from, 1);
    if (pending === undefined) return ok("otlp exporter", `up to date (${target})`);
    const lag = this.#events.lastPosition().value - from.value;
    const behindMs = this.#clock.now().epochMs() - pending.record.recordedAt.epochMs();
    return behindMs > STALE_MS
      ? warn("otlp exporter", `${lag} events not exported for ${Math.floor(behindMs / 60_000)} min (${target}); check that the host is running and the collector is reachable`)
      : ok("otlp exporter", `lag ${lag} (${target})`);
  }
}
