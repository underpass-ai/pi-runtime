import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SqliteDatabase } from "../../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";

test("transaction: sólo hace ROLLBACK si la transacción sigue activa, y siempre relanza el error original", () => {
  const db = SqliteDatabase.open(":memory:");
  assert.throws(
    () => db.transaction(() => { db.handle.exec("ROLLBACK"); throw new Error("boom"); }),
    /boom/,
  );
  db.close();
});

test("transaction: camino de éxito hace COMMIT y devuelve el resultado de fn", () => {
  const db = SqliteDatabase.open(":memory:");
  const result = db.transaction(() => { db.handle.exec("INSERT INTO meta(key, value) VALUES ('x', '1')"); return 42; });
  assert.equal(result, 42);
  assert.equal(db.handle.prepare("SELECT value FROM meta WHERE key = 'x'").get()!.value, "1");
  db.close();
});

const opener = new URL("../../../../fixtures/db-opener.ts", import.meta.url).pathname;
const runOpen = (db: string) => new Promise<number>((resolve) => {
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", opener, db], { stdio: "inherit" }).on("exit", (c) => resolve(c ?? -1));
});

test("open: busy_timeout se fija antes de journal_mode=WAL, dos aperturas concurrentes de una ruta nueva no fallan", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "events-")), "events.sqlite3");
  assert.deepEqual(await Promise.all([runOpen(db), runOpen(db)]), [0, 0]);
});
