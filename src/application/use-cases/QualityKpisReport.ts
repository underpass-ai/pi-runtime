import type { SessionId } from "../../domain/events/SessionId.ts";
import type { KpiTallyDto } from "../dto/KpiTallyDto.ts";
import type { QualityKpisDto } from "../dto/QualityKpisDto.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { QualityKpisProjection } from "../projections/QualityKpisProjection.ts";

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export class QualityKpisReport {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }

  // Global siempre responde (a ceros si no hay datos); una sesión desconocida es null.
  execute(session?: SessionId): QualityKpisDto | null {
    const key = session === undefined ? "global" : `session:${session.value}`;
    const tally = this.#store.load(QualityKpisProjection.NAME).get(key) as KpiTallyDto | undefined;
    if (tally === undefined) return session === undefined ? QualityKpisReport.toDto("global", QualityKpisProjection.emptyTally()) : null;
    return QualityKpisReport.toDto(session?.value ?? "global", tally);
  }

  static toDto(scope: string, t: KpiTallyDto): QualityKpisDto {
    return {
      scope, sessions: t.sessions, turns: t.turns, cost: t.cost, tokens: { ...t.tokens }, invocations: t.invocations,
      firstTrySuccess: ratio(t.firstTrySucceeded, t.firstTryAttempted), refusalRate: ratio(t.refused, t.invocations),
      cacheRatio: ratio(t.tokens.cacheRead, t.tokens.input + t.tokens.cacheRead), compactions: t.compactions, compactionsPerSession: ratio(t.compactions, t.sessions),
    };
  }
}
