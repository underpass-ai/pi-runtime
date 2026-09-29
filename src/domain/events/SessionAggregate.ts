import { DomainError } from "../shared/DomainError.ts";
import type { EventRecord } from "./EventRecord.ts";
import type { Fact } from "./Fact.ts";
import { SessionState } from "./SessionState.ts";

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

export class SessionAggregate {
  private constructor() {}

  static decide(state: SessionState, fact: Fact): Fact {
    if (fact.type.value === "session.opened") {
      if (state.open) throw DomainError.because("session already open");
      return fact;
    }
    if (!state.open) throw DomainError.because(`${fact.type.value} requires an open session`);
    return fact;
  }

  // Infalible: sin reloj, sin validación; un payload inesperado cuenta como ausente.
  static apply(state: SessionState, r: EventRecord): SessionState {
    const p = obj(r.payload.toValue());
    switch (r.type.value) {
      case "session.opened": return state.with({ open: true, everOpened: true });
      case "session.closed": return state.with({ open: false });
      case "phase.changed": return state.with({ phase: str(p.to) ?? state.phase });
      case "model.selected": return state.with({ model: str(p.model) ?? state.model });
      case "turn.completed": {
        const t = obj(p.tokens);
        return state.with({ turns: state.turns + 1, model: str(p.model) ?? state.model, tokensIn: state.tokensIn + num(t.input),
          tokensOut: state.tokensOut + num(t.output), tokensCached: state.tokensCached + num(t.cacheRead), cost: state.cost + num(p.cost) });
      }
      case "tool.completed": {
        const server = str(p.server) ?? "unknown"; const status = str(p.status) ?? "unknown";
        const byStatus = state.calls[server] ?? {};
        return state.with({ calls: { ...state.calls, [server]: { ...byStatus, [status]: (byStatus[status] ?? 0) + 1 } } as Record<string, Record<string, number>> });
      }
      default: return state;
    }
  }

  static fold(records: EventRecord[]): SessionState { return records.reduce((s, r) => SessionAggregate.apply(s, r), SessionState.EMPTY); }
}
