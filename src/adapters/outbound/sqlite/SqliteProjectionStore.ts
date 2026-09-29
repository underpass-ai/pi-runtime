import type { ProjectionStore } from "../../../application/ports/ProjectionStore.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../../domain/events/ProjectionName.ts";
import type { SqliteDatabase } from "./SqliteDatabase.ts";

type Row = Record<string, unknown>;

export class SqliteProjectionStore implements ProjectionStore {
  readonly #db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.#db = db; }

  cursor(name: ProjectionName): ProjectionCursor | null {
    const row = this.#db.handle.prepare("SELECT projection_version, position FROM cursors WHERE consumer = ?").get(name.value) as Row | undefined;
    return row === undefined ? null : ProjectionCursor.of(Number(row.projection_version), GlobalPosition.of(Number(row.position)));
  }

  load(name: ProjectionName): Map<string, unknown> {
    return new Map((this.#db.handle.prepare("SELECT key, value FROM projection_state WHERE consumer = ?").all(name.value) as Row[])
      .map((r) => [String(r.key), JSON.parse(String(r.value))]));
  }

  commit(name: ProjectionName, cursor: ProjectionCursor, changes: Map<string, unknown>): void {
    this.#db.transaction(() => {
      const put = this.#db.handle.prepare("INSERT INTO projection_state (consumer, key, value) VALUES (?, ?, ?) ON CONFLICT(consumer, key) DO UPDATE SET value = excluded.value");
      for (const [k, v] of changes) put.run(name.value, k, JSON.stringify(v));
      this.#setCursor(name, cursor);
    });
  }

  reset(name: ProjectionName, version: number): void {
    this.#db.transaction(() => {
      this.#db.handle.prepare("DELETE FROM projection_state WHERE consumer = ?").run(name.value);
      this.#db.handle.prepare("DELETE FROM projection_quarantine WHERE consumer = ?").run(name.value);
      this.#setCursor(name, ProjectionCursor.of(version, GlobalPosition.START));
    });
  }

  quarantine(name: ProjectionName, position: GlobalPosition, reason: string): void {
    this.#db.handle.prepare("INSERT OR REPLACE INTO projection_quarantine (consumer, global_position, reason) VALUES (?, ?, ?)").run(name.value, position.value, reason);
  }

  quarantined(name: ProjectionName): { position: GlobalPosition; reason: string }[] {
    return (this.#db.handle.prepare("SELECT global_position, reason FROM projection_quarantine WHERE consumer = ? ORDER BY global_position").all(name.value) as Row[])
      .map((r) => ({ position: GlobalPosition.of(Number(r.global_position)), reason: String(r.reason) }));
  }

  #setCursor(name: ProjectionName, cursor: ProjectionCursor): void {
    this.#db.handle.prepare(`INSERT INTO cursors (consumer, projection_version, position) VALUES (?, ?, ?)
      ON CONFLICT(consumer) DO UPDATE SET projection_version = excluded.projection_version, position = excluded.position`).run(name.value, cursor.version, cursor.position.value);
  }
}
