import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { SessionSummaryDto } from "../dto/SessionSummaryDto.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

export class SessionSummaryProjection implements Projection {
  static readonly NAME = ProjectionName.of("session_summary");
  readonly name = SessionSummaryProjection.NAME;
  // v2: openedAt es la PRIMERA apertura (antes, la última); subirla reconstruye los resúmenes persistidos.
  readonly version = 2;

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record;
    if (!r.stream.isSession()) return;
    const id = r.stream.sessionId().value;
    const key = `session:${id}`;
    const s = state.get<SessionSummaryDto>(key) ?? { sessionId: id, openedAt: null, closedAt: null, phase: null, model: null, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, calls: {}, failures: 0, lastEventAt: r.occurredAt.value };
    const p = obj(r.payload.toValue());
    switch (r.type.value) {
      // Un session.opened sobre una sesión ya abierta es la reapertura implícita tras caerse Pi
      // (y uno tras session.closed, un resume): openedAt conserva la primera apertura, closedAt se
      // borra y los contadores siguen acumulando, sin reiniciarse ni contar dos veces.
      case "session.opened": s.openedAt ??= r.occurredAt.value; s.closedAt = null; break;
      case "session.closed": s.closedAt = r.occurredAt.value; break;
      case "phase.changed": s.phase = str(p.to) ?? s.phase; break;
      case "model.selected": s.model = str(p.model) ?? s.model; break;
      case "turn.completed": {
        const t = obj(p.tokens);
        s.turns++; s.model = str(p.model) ?? s.model; s.cost += num(p.cost);
        s.tokens = { input: s.tokens.input + num(t.input), output: s.tokens.output + num(t.output), cacheRead: s.tokens.cacheRead + num(t.cacheRead), cacheWrite: s.tokens.cacheWrite + num(t.cacheWrite) };
        if (p.outcome === "error") s.failures++;
        break;
      }
      case "tool.completed": {
        const server = str(p.server) ?? "unknown"; const status = str(p.status) ?? "unknown";
        s.calls[server] = { ...(s.calls[server] ?? {}), [status]: (s.calls[server]?.[status] ?? 0) + 1 };
        if (status === "failed") s.failures++;
        break;
      }
    }
    s.lastEventAt = r.occurredAt.value;
    state.set(key, s);
  }
}
