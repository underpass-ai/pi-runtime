import { TelemetryMetricsProjection } from "../../../application/projections/TelemetryMetricsProjection.ts";
import type { ProjectionLag } from "../../../application/use-cases/ProjectionLag.ts";
import type { ReadTelemetryMetrics } from "../../../application/use-cases/ReadTelemetryMetrics.ts";
import { SessionId } from "../../../domain/events/SessionId.ts";
import { PrometheusTextRenderer } from "./PrometheusTextRenderer.ts";

type Deps = { read: ReadTelemetryMetrics; lag: ProjectionLag; print: (s: string) => void };
const USAGE = "usage: underpass metrics [--session <id>]";

// `underpass metrics [--session <id>]`. Los avisos van como comentarios (`#`): la salida
// sigue siendo texto Prometheus válido.
export class MetricsCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  run(args: string[]): number {
    const d = this.#d;
    const valid = args.length === 0 || (args.length === 2 && args[0] === "--session" && args[1] !== "");
    if (!valid) { d.print(USAGE); return 2; }
    try {
      const session = args.length === 2 ? SessionId.of(args[1]) : undefined;
      const behind = session === undefined ? d.lag.execute(TelemetryMetricsProjection.NAME) : [];
      for (const b of behind) d.print(`# projections behind (${b.position}/${b.last}): start pi in this project or run underpass events rebuild ${b.projection}`);
      const snapshot = d.read.execute(session);
      if (snapshot.isEmpty()) { if (behind.length === 0) d.print("# no metrics recorded yet"); return 0; }
      d.print(new PrometheusTextRenderer().render(snapshot));
      return 0;
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }
}
