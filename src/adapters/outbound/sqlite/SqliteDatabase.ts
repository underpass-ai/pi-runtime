import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (global_position INTEGER PRIMARY KEY, stream TEXT NOT NULL, version INTEGER NOT NULL, event_id TEXT NOT NULL,
  type TEXT NOT NULL, type_version INTEGER NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL, causation_id TEXT, payload TEXT NOT NULL, prev_hash TEXT, hash TEXT NOT NULL,
  UNIQUE(stream, version), UNIQUE(stream, event_id)) STRICT;
CREATE TABLE IF NOT EXISTS streams (stream TEXT PRIMARY KEY, version INTEGER NOT NULL, head_hash TEXT NOT NULL, last_event_id TEXT NOT NULL, correlation_id TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS cursors (consumer TEXT PRIMARY KEY, projection_version INTEGER NOT NULL, position INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS projection_state (consumer TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(consumer, key)) STRICT;
CREATE TABLE IF NOT EXISTS projection_quarantine (consumer TEXT NOT NULL, global_position INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(consumer, global_position)) STRICT;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
`;

export class SqliteDatabase {
  readonly #db: DatabaseSync;
  private constructor(db: DatabaseSync) { this.#db = db; }

  static open(path: string): SqliteDatabase {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec(SCHEMA);
    return new SqliteDatabase(db);
  }

  get handle(): DatabaseSync { return this.#db; }

  transaction<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.#db.exec("COMMIT"); return result; }
    catch (e) {
      if (this.#db.isTransaction) { try { this.#db.exec("ROLLBACK"); } catch { /* preserve original error below */ } }
      throw e;
    }
  }

  close(): void { this.#db.close(); }
}
