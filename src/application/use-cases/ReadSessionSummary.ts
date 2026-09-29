import type { SessionId } from "../../domain/events/SessionId.ts";
import type { SessionSummaryDto } from "../dto/SessionSummaryDto.ts";
import { SessionSummaryProjection } from "../projections/SessionSummaryProjection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";

export class ReadSessionSummary {
  readonly #store: ProjectionStore; readonly #refresh: () => void;
  constructor(store: ProjectionStore, refresh: () => void = () => {}) { this.#store = store; this.#refresh = refresh; }
  execute(id: SessionId): SessionSummaryDto | null {
    this.#refresh();
    return (this.#store.load(SessionSummaryProjection.NAME).get(`session:${id.value}`) as SessionSummaryDto | undefined) ?? null;
  }
}
