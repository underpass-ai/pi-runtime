import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SqliteDatabase } from "../../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { StreamVerifier } from "../../../../../src/domain/events/StreamVerifier.ts";
import { eventStoreConformance } from "../../../../support/EventStoreConformance.ts";
import { SESSION } from "../../../../support/recordFixtures.ts";

eventStoreConformance("sqlite", () => new SqliteEventStore(SqliteDatabase.open(":memory:")));

const appender = new URL("../../../../fixtures/event-appender.ts", import.meta.url).pathname;
const run = (db: string, prefix: string, n: number) => new Promise<number>((resolve) => {
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", appender, db, prefix, String(n)], { stdio: "inherit" }).on("exit", (c) => resolve(c ?? -1));
});

test("dos procesos concurrentes: ningún hueco, un único opened y la cadena íntegra", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "events-")), "events.sqlite3");
  SqliteDatabase.open(db).close();
  assert.deepEqual(await Promise.all([run(db, "a", 25), run(db, "b", 25)]), [0, 0]);
  const store = new SqliteEventStore(SqliteDatabase.open(db));
  const records = store.readStream(SESSION);
  assert.ok(StreamVerifier.verify(records).isIntact());
  assert.equal(records.filter((r) => r.type.value === "session.opened").length, 1);
  assert.ok(records.length >= 49);
});

test("la base se reabre con el mismo contenido y la transacción deshace si hay error", () => {
  const path = join(mkdtempSync(join(tmpdir(), "events-")), "sub", "events.sqlite3");
  const db = SqliteDatabase.open(path);
  assert.throws(() => db.transaction(() => { db.handle.exec("INSERT INTO meta(key, value) VALUES ('x', '1')"); throw new Error("boom"); }), /boom/);
  assert.equal(db.handle.prepare("SELECT COUNT(*) AS n FROM meta WHERE key = 'x'").get()!.n, 0);
  db.close();
  assert.equal(SqliteDatabase.open(path).handle.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()!.value, "1");
});
