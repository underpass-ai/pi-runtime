import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

export interface Projection {
  readonly name: ProjectionName;
  readonly version: number;
  apply(state: ProjectionState, event: StoredEvent): void;
}
