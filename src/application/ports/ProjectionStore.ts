import type { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { ProjectionCursor } from "../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../domain/events/ProjectionName.ts";

// Hay dos escritores posibles del mismo log: el runner del host y `underpass
// events rebuild`. commit es un compare-and-set sobre el cursor: sólo escribe
// (estado y cursor, en una transacción) si el cursor sigue siendo `expected`;
// sin fila, sólo si `expected` es el cursor inicial. Devuelve false, sin
// escribir nada, si otro escritor lo movió (o un reset lo invalidó).
// snapshot lee cursor y estado de forma consistente (una transacción de
// lectura en SQLite).
export interface ProjectionStore {
  cursor(name: ProjectionName): ProjectionCursor | null;
  load(name: ProjectionName): Map<string, unknown>;
  snapshot(name: ProjectionName): { cursor: ProjectionCursor | null; state: Map<string, unknown> };
  commit(name: ProjectionName, expected: ProjectionCursor, next: ProjectionCursor, changes: Map<string, unknown>): boolean;
  reset(name: ProjectionName, version: number): void;
  quarantine(name: ProjectionName, position: GlobalPosition, reason: string): void;
  quarantined(name: ProjectionName): { position: GlobalPosition; reason: string }[];
}
