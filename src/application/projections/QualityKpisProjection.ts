import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { KpiTallyDto } from "../dto/KpiTallyDto.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const MAX_TURN_TOOLS = 256;

// KPIs de calidad (spec §3), globales (`global`) y por sesión (`session:<id>`).
// Éxito a la primera: de cada tool, sólo su primera invocación dentro del turno
// cuenta, y acierta si sale `succeeded`. `turn:<id>` guarda las tools ya vistas en el
// turno en curso; `turn.completed` (que Pi emite tras ejecutar las tools del turno),
// la apertura y el cierre lo vacían.
export class QualityKpisProjection implements Projection {
  static readonly NAME = ProjectionName.of("quality_kpis");
  static readonly VERSION = 1;
  readonly name = QualityKpisProjection.NAME;
  readonly version = QualityKpisProjection.VERSION;

  static emptyTally(): KpiTallyDto {
    return { sessions: 0, turns: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, invocations: 0, refused: 0, firstTryAttempted: 0, firstTrySucceeded: 0, compactions: 0 };
  }

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record;
    if (!r.stream.isSession()) return;
    const sid = r.stream.sessionId().value; const p = obj(r.payload.toValue());
    const sessionKey = `session:${sid}`; const turnKey = `turn:${sid}`;
    const edit = (fn: (t: KpiTallyDto) => void) => {
      for (const key of ["global", sessionKey]) { const t = state.get<KpiTallyDto>(key) ?? QualityKpisProjection.emptyTally(); fn(t); state.set(key, t); }
    };
    switch (r.type.value) {
      case "session.opened":
        if (state.get<KpiTallyDto>(sessionKey) === undefined) edit((t) => { t.sessions++; });
        state.set(turnKey, []);
        break;
      case "turn.completed": {
        const tokens = obj(p.tokens);
        edit((t) => {
          t.turns++; t.cost += n(p.cost);
          t.tokens = { input: t.tokens.input + n(tokens.input), output: t.tokens.output + n(tokens.output), cacheRead: t.tokens.cacheRead + n(tokens.cacheRead), cacheWrite: t.tokens.cacheWrite + n(tokens.cacheWrite) };
        });
        state.set(turnKey, []);
        break;
      }
      case "tool.completed": {
        const tool = typeof p.tool === "string" ? p.tool : "unknown";
        const seen = state.get<string[]>(turnKey) ?? [];
        const first = !seen.includes(tool);
        edit((t) => {
          t.invocations++;
          if (p.status === "refused") t.refused++;
          if (first) { t.firstTryAttempted++; if (p.status === "succeeded") t.firstTrySucceeded++; }
        });
        if (first && seen.length < MAX_TURN_TOOLS) state.set(turnKey, [...seen, tool]);
        break;
      }
      case "context.compacted": edit((t) => { t.compactions++; }); break;
      case "session.closed": state.set(turnKey, []); break;
    }
  }
}
