import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import { HistogramValue } from "../../domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../domain/telemetry/MetricCatalog.ts";
import type { MetricDescriptor } from "../../domain/telemetry/MetricDescriptor.ts";
import { MetricKey } from "../../domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../domain/telemetry/MetricLabels.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const STATUSES = ["succeeded", "failed", "refused", "aborted"];
const TOKEN_KINDS: [string, string][] = [["input", "input"], ["output", "output"], ["cache_read", "cacheRead"], ["cache_write", "cacheWrite"]];
const L = (v: unknown) => LabelValue.orUnknown(v);

// Contadores acumulados e histograma de duración (spec §2). Tolerante: un payload
// inesperado cuenta como dato ausente (`unknown`, 0 o sin observación); sólo un error
// de programación llega a la cuarentena de E1. `session|<stream>` es estado auxiliar
// (abierta o cerrada) para distinguir `opened` de `reopened`.
export class TelemetryMetricsProjection implements Projection {
  static readonly NAME = ProjectionName.of("telemetry_metrics");
  static readonly VERSION = 1;
  readonly name = TelemetryMetricsProjection.NAME;
  readonly version = TelemetryMetricsProjection.VERSION;

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record; const p = obj(r.payload.toValue());
    switch (r.type.value) {
      case "tool.completed": {
        const tool = L(p.tool); const server = L(p.server);
        const status = typeof p.status === "string" && STATUSES.includes(p.status) ? LabelValue.of(p.status) : LabelValue.UNKNOWN;
        this.#add(state, MetricCatalog.TOOL_INVOCATIONS, { tool, server, status }, 1);
        if (status.value === "refused") this.#add(state, MetricCatalog.TOOL_REFUSED, { tool, reason: L(p.errorCode) }, 1);
        const duration = num(p.durationMs);
        if (duration !== null && duration >= 0) this.#observe(state, MetricCatalog.TOOL_DURATION, { tool, server }, duration);
        break;
      }
      case "turn.completed": {
        const model = L(p.model); const provider = L(p.provider); const tokens = obj(p.tokens);
        this.#add(state, MetricCatalog.TURNS, { model, provider, outcome: L(p.outcome) }, 1);
        for (const [kind, field] of TOKEN_KINDS) this.#add(state, MetricCatalog.TOKENS, { model, provider, kind: LabelValue.of(kind) }, num(tokens[field]) ?? 0);
        this.#add(state, MetricCatalog.COST, { model, provider }, num(p.cost) ?? 0);
        break;
      }
      case "session.opened": {
        const key = `session|${r.stream.value}`;
        const seen = state.get<string>(key) !== undefined;
        state.set(key, "open");
        this.#add(state, MetricCatalog.SESSIONS, { event: LabelValue.of(seen ? "reopened" : "opened") }, 1);
        break;
      }
      case "session.closed":
        state.set(`session|${r.stream.value}`, "closed");
        this.#add(state, MetricCatalog.SESSIONS, { event: LabelValue.of("closed") }, 1);
        break;
      case "context.compacted": this.#add(state, MetricCatalog.COMPACTIONS, { reason: L(p.reason) }, 1); break;
      case "server.started": this.#add(state, MetricCatalog.SERVER_STARTS, { server: L(p.server) }, 1); break;
      case "server.exited": this.#add(state, MetricCatalog.SERVER_EXITS, { server: L(p.server), code: L(p.code) }, 1); break;
    }
  }

  // Un incremento negativo nunca entra: los contadores sólo crecen.
  #add(state: ProjectionState, d: MetricDescriptor, labels: Record<string, LabelValue>, by: number): void {
    const key = MetricKey.of(d, MetricLabels.of(labels)).text;
    state.set(key, (state.get<number>(key) ?? 0) + Math.max(0, by));
  }

  #observe(state: ProjectionState, d: MetricDescriptor, labels: Record<string, LabelValue>, ms: number): void {
    const key = MetricKey.of(d, MetricLabels.of(labels)).text;
    const current = state.get<unknown>(key);
    state.set(key, (current === undefined ? HistogramValue.EMPTY : HistogramValue.fromJson(current)).observe(ms).toJson());
  }
}
