import type { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { ProjectionCursor } from "../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../domain/events/ProjectionName.ts";

export interface ProjectionStore {
  cursor(name: ProjectionName): ProjectionCursor | null;
  load(name: ProjectionName): Map<string, unknown>;
  commit(name: ProjectionName, cursor: ProjectionCursor, changes: Map<string, unknown>): void;
  reset(name: ProjectionName, version: number): void;
  quarantine(name: ProjectionName, position: GlobalPosition, reason: string): void;
  quarantined(name: ProjectionName): { position: GlobalPosition; reason: string }[];
}
