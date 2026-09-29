import { test } from "node:test";
import assert from "node:assert/strict";
import { BundleDigest } from "../../../../src/domain/events/BundleDigest.ts";
import { ExportEventLog } from "../../../../src/application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../../../../src/application/use-cases/ImportEventLog.ts";
import { VerifyEventLog } from "../../../../src/application/use-cases/VerifyEventLog.ts";
import { ShowSession } from "../../../../src/application/use-cases/ShowSession.ts";
import { RebuildProjection } from "../../../../src/application/use-cases/RebuildProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import type { ProjectionState } from "../../../../src/application/services/ProjectionState.ts";
import type { Projection } from "../../../../src/application/ports/Projection.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { ProjectionName } from "../../../../src/domain/events/ProjectionName.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import type { StoredEvent } from "../../../../src/domain/events/StoredEvent.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

function seeded() {
  const s = new InMemoryEventStore();
  s.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t1", { model: "m" })], AT);
  s.append(StreamId.HOST, StreamVersion.NONE, [fact("host.started", "h", {}, StreamId.HOST)], AT);
  return s;
}

test("export → import en un almacén vacío reproduce el log; reimportar no duplica", () => {
  const src = seeded();
  const lines = new ExportEventLog(src, ProjectId.of("0123456789abcdef")).execute();
  const header = JSON.parse(lines[0]);
  assert.deepEqual([header.format, header.count, header.from, header.to], ["pi-runtime.events.v1", 3, 1, 3]);
  const dst = new InMemoryEventStore();
  assert.equal(new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute(lines).imported, 3);
  assert.equal(new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute(lines).imported, 0);
  assert.deepEqual(dst.readStream(SESSION).map((r) => r.hash.value), src.readStream(SESSION).map((r) => r.hash.value));
  assert.ok(new VerifyEventLog(dst).execute().every((x) => x.result.isIntact()));
  assert.equal(new VerifyEventLog(dst).execute(SESSION).length, 1);
});

test("rechaza cabecera, digest y formato incorrectos", () => {
  const lines = new ExportEventLog(seeded(), ProjectId.of("0123456789abcdef")).execute();
  const dst = new InMemoryEventStore();
  assert.throws(() => new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute([]), /header/);
  assert.throws(() => new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute([lines[0].replace("pi-runtime.events.v1", "x"), ...lines.slice(1)]), /format/);
  assert.throws(() => new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute([lines[0], ...lines.slice(2)]), /sha256/);
  assert.equal(dst.lastPosition().value, 0);
});

test("show devuelve la línea temporal con metadatos", () => {
  const rows = new ShowSession(seeded()).execute(SessionId.of("s1"));
  assert.deepEqual(rows.map((r) => [r.version, r.type]), [[1, "session.opened"], [2, "turn.completed"]]);
  assert.deepEqual(rows[1].payload, { model: "m" });
});

test("sqlite: export → import en un almacén vacío reproduce el log", () => {
  const src = new SqliteEventStore(SqliteDatabase.open(":memory:"));
  src.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t1", { model: "m" })], AT);
  src.append(StreamId.HOST, StreamVersion.NONE, [fact("host.started", "h", {}, StreamId.HOST)], AT);
  const lines = new ExportEventLog(src, ProjectId.of("0123456789abcdef")).execute();
  const dst = new SqliteEventStore(SqliteDatabase.open(":memory:"));
  assert.equal(new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute(lines).imported, 3);
  assert.deepEqual(dst.readStream(SESSION).map((r) => r.hash.value), src.readStream(SESSION).map((r) => r.hash.value));
  assert.ok(new VerifyEventLog(dst).execute().every((x) => x.result.isIntact()));
});

test("rechaza un bundle manipulado (sha256 recalculado pero un registro con hash roto) sin escribir nada", () => {
  const lines = new ExportEventLog(seeded(), ProjectId.of("0123456789abcdef")).execute();
  const header = JSON.parse(lines[0]);
  const body = [...lines.slice(1)];
  const tampered = JSON.parse(body[1]);
  tampered.hash = "f".repeat(64);
  body[1] = JSON.stringify(tampered);
  const newHeader = JSON.stringify({ ...header, sha256: BundleDigest.of(body) });
  const dst = new InMemoryEventStore();
  assert.throws(() => new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute([newHeader, ...body]), /cadena|chain|broken|link/i);
  assert.equal(dst.lastPosition().value, 0);
});

test("RebuildProjection delega en el runner y propaga el fallo de una proyección desconocida", () => {
  class Counter implements Projection {
    readonly name = ProjectionName.of("counter"); readonly version = 1;
    apply(state: ProjectionState, _e: StoredEvent): void { state.set("count", (state.get<number>("count") ?? 0) + 1); }
  }
  const events = seeded(); const store = new InMemoryProjectionStore(); const p = new Counter();
  const runner = new ProjectionRunner(events, store, [p]);
  new RebuildProjection(runner).execute(p.name);
  assert.equal(store.load(p.name).get("count"), 3);
  assert.throws(() => new RebuildProjection(runner).execute(ProjectionName.of("missing")), /unknown projection/);
});

test("un bundle de otro proyecto se importa igual pero avisa; el mismo proyecto no avisa", () => {
  const lines = new ExportEventLog(seeded(), ProjectId.of("0123456789abcdef")).execute();
  const same = new ImportEventLog(new InMemoryEventStore(), ProjectId.of("0123456789abcdef")).execute(lines);
  assert.deepEqual(same, { imported: 3, warnings: [] });
  const other = new ImportEventLog(new InMemoryEventStore(), ProjectId.of("fedcba9876543210")).execute(lines);
  assert.equal(other.imported, 3);
  assert.deepEqual(other.warnings, ["bundle project_id 0123456789abcdef differs from this project (fedcba9876543210)"]);
});
