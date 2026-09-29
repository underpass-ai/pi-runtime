import type { SessionSummaryDto } from "../dto/SessionSummaryDto.ts";
import { SessionSummaryProjection } from "../projections/SessionSummaryProjection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";

export class ListSessions {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }
  execute(): SessionSummaryDto[] {
    return [...this.#store.load(SessionSummaryProjection.NAME).entries()].filter(([k]) => k.startsWith("session:")).map(([, v]) => v as SessionSummaryDto)
      .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""));
  }
}
