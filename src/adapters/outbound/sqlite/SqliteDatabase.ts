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
    db.exec("PRAGMA busy_timeout=10000;");
    // Pasar a WAL (y el primer DDL) con otra conexión abriendo el mismo fichero nuevo puede
    // devolver SQLITE_BUSY sin pasar por el busy handler: se reintenta dentro del mismo plazo.
    SqliteDatabase.#whileBusy(() => db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;"));
    SqliteDatabase.#whileBusy(() => db.exec(SCHEMA));
    return new SqliteDatabase(db);
  }

  static #whileBusy(work: () => void, budgetMs = 10_000): void {
    const deadline = Date.now() + budgetMs;
    for (let pause = 5; ; pause = Math.min(pause * 2, 200)) {
      try { work(); return; }
      catch (e) {
        if (!/database is locked|SQLITE_BUSY/.test((e as Error).message) || Date.now() >= deadline) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pause);
      }
    }
  }

  // Lectura sin efectos sobre el log: ni crea el fichero, ni ejecuta el DDL,
  // ni cambia el modo de journal (doctor y verbos de consulta). Aceptado
  // (decisión R7): como lector WAL, SQLite puede crear o dejar los sidecars
  // `-wal` y `-shm` junto al log; nunca otra cosa, y el log no se modifica.
  static openReadOnly(path: string): SqliteDatabase {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout=10000;");
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

  // Transacción de lectura (BEGIN diferido): en WAL todas las lecturas de fn
  // ven la misma instantánea.
  read<T>(fn: () => T): T {
    this.#db.exec("BEGIN");
    try { return fn(); } finally { this.#db.exec("COMMIT"); }
  }

  close(): void { this.#db.close(); }
}
