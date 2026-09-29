import type { TelemetryEpochStore } from "../../../application/ports/TelemetryEpochStore.ts";
import { TelemetryEpoch } from "../../../domain/telemetry/TelemetryEpoch.ts";
import type { SqliteDatabase } from "./SqliteDatabase.ts";

const KEY = "telemetry_start";

export class SqliteTelemetryEpochStore implements TelemetryEpochStore {
  readonly #db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.#db = db; }

  read(): TelemetryEpoch | null {
    const row = this.#db.handle.prepare("SELECT value FROM meta WHERE key = ?").get(KEY) as { value?: unknown } | undefined;
    return row === undefined ? null : TelemetryEpoch.parse(String(row.value));
  }

  write(epoch: TelemetryEpoch): void {
    this.#db.handle.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, epoch.text);
  }
}
