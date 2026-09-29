import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTelemetryEpochStore } from "../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteTelemetryEpochStore } from "../../../../src/adapters/outbound/sqlite/SqliteTelemetryEpochStore.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { TelemetryEpochs } from "../../../../src/application/services/TelemetryEpochs.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { TelemetryEpoch } from "../../../../src/domain/telemetry/TelemetryEpoch.ts";
import { ManualClock } from "../../../support/ManualClock.ts";

test("el inicio del acumulado se fija una vez, se conserva y se reinicia con otra versión de la proyección o a mano", () => {
  const store = new InMemoryTelemetryEpochStore(); const clock = new ManualClock(1000);
  const epochs = new TelemetryEpochs(store, clock);
  const first = epochs.current();
  assert.deepEqual([first.start.epochMs(), first.projectionVersion], [1000, TelemetryMetricsProjection.VERSION]);
  clock.ms = 5000;
  assert.equal(epochs.current().start.epochMs(), 1000);
  store.write(TelemetryEpoch.of(Timestamp.fromEpochMs(10), 99));
  assert.equal(epochs.current().start.epochMs(), 5000);
  clock.ms = 7000;
  assert.equal(epochs.restart().start.epochMs(), 7000);
  assert.equal(store.read()?.start.epochMs(), 7000);
});

test("TelemetryEpoch: texto canónico reversible; un valor ilegible cuenta como ausente", () => {
  const e = TelemetryEpoch.of(Timestamp.fromEpochMs(1234), 1);
  assert.equal(e.text, '{"projectionVersion":1,"start":"1970-01-01T00:00:01.234Z"}');
  assert.equal(TelemetryEpoch.parse(e.text)?.start.epochMs(), 1234);
  for (const bad of ["x", "{}", '{"start":"ayer","projectionVersion":1}', '{"start":"1970-01-01T00:00:01.234Z","projectionVersion":0}']) assert.equal(TelemetryEpoch.parse(bad), null, bad);
  assert.throws(() => TelemetryEpoch.of(Timestamp.fromEpochMs(0), 1.5), DomainError);
});

test("SQLite: el inicio vive en meta (telemetry_start) y sobrevive a reabrir el log", () => {
  const file = join(mkdtempSync(join(tmpdir(), "epoch-")), "events.sqlite3");
  let db = SqliteDatabase.open(file);
  assert.equal(new SqliteTelemetryEpochStore(db).read(), null);
  new SqliteTelemetryEpochStore(db).write(TelemetryEpoch.of(Timestamp.fromEpochMs(1234), 1));
  new SqliteTelemetryEpochStore(db).write(TelemetryEpoch.of(Timestamp.fromEpochMs(5678), 1));
  db.close();
  db = SqliteDatabase.open(file);
  assert.equal(new SqliteTelemetryEpochStore(db).read()?.start.epochMs(), 5678);
  db.handle.prepare("UPDATE meta SET value = 'x' WHERE key = 'telemetry_start'").run();
  assert.equal(new SqliteTelemetryEpochStore(db).read(), null);
  db.close();
});
