import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { SessionSummaryDto } from "../dto/SessionSummaryDto.ts";
import { SessionSummaryProjection } from "../projections/SessionSummaryProjection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";

export class ListSessions {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }
  // `since` filtra por apertura: una sesión sin `session.opened` conocido no entra en una consulta acotada.
  execute(since?: Timestamp): SessionSummaryDto[] {
    return [...this.#store.load(SessionSummaryProjection.NAME).entries()].filter(([k]) => k.startsWith("session:")).map(([, v]) => v as SessionSummaryDto)
      .filter((s) => since === undefined || (s.openedAt !== null && s.openedAt >= since.value))
      .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""));
  }
}
