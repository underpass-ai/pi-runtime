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

  snapshot(name: ProjectionName): { cursor: ProjectionCursor | null; state: Map<string, unknown> } {
    return this.#db.read(() => ({ cursor: this.cursor(name), state: this.load(name) }));
  }

  // Compare-and-set del cursor dentro de la transacción de escritura: si no
  // cuadra no se toca nada (ni estado ni cursor).
  commit(name: ProjectionName, expected: ProjectionCursor, next: ProjectionCursor, changes: Map<string, unknown>): boolean {
    return this.#db.transaction(() => {
      let moved = Number(this.#db.handle.prepare("UPDATE cursors SET projection_version = ?, position = ? WHERE consumer = ? AND projection_version = ? AND position = ?")
        .run(next.version, next.position.value, name.value, expected.version, expected.position.value).changes);
      if (moved === 0 && expected.position.equals(GlobalPosition.START)) {
        moved = Number(this.#db.handle.prepare("INSERT INTO cursors (consumer, projection_version, position) VALUES (?, ?, ?) ON CONFLICT(consumer) DO NOTHING")
          .run(name.value, next.version, next.position.value).changes);
      }
      if (moved === 0) return false;
      const put = this.#db.handle.prepare("INSERT INTO projection_state (consumer, key, value) VALUES (?, ?, ?) ON CONFLICT(consumer, key) DO UPDATE SET value = excluded.value");
      const drop = this.#db.handle.prepare("DELETE FROM projection_state WHERE consumer = ? AND key = ?");
      for (const [k, v] of changes) { if (v === undefined) drop.run(name.value, k); else put.run(name.value, k, JSON.stringify(v)); }
      return true;
    });
  }

  reset(name: ProjectionName, version: number): void {
    this.#db.transaction(() => {
      this.#db.handle.prepare("DELETE FROM projection_state WHERE consumer = ?").run(name.value);
      this.#db.handle.prepare("DELETE FROM projection_quarantine WHERE consumer = ?").run(name.value);
      this.#db.handle.prepare(`INSERT INTO cursors (consumer, projection_version, position) VALUES (?, ?, 0)
        ON CONFLICT(consumer) DO UPDATE SET projection_version = excluded.projection_version, position = 0`).run(name.value, version);
    });
  }

  quarantine(name: ProjectionName, position: GlobalPosition, reason: string): void {
    this.#db.handle.prepare("INSERT OR REPLACE INTO projection_quarantine (consumer, global_position, reason) VALUES (?, ?, ?)").run(name.value, position.value, reason);
  }

  quarantined(name: ProjectionName): { position: GlobalPosition; reason: string }[] {
    return (this.#db.handle.prepare("SELECT global_position, reason FROM projection_quarantine WHERE consumer = ? ORDER BY global_position").all(name.value) as Row[])
      .map((r) => ({ position: GlobalPosition.of(Number(r.global_position)), reason: String(r.reason) }));
  }
}
