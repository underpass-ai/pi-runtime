import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { ExportEventLog } from "../../../../src/application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../../../../src/application/use-cases/ImportEventLog.ts";
import { VerifyEventLog } from "../../../../src/application/use-cases/VerifyEventLog.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { HostComposition } from "../../../../src/composition/HostComposition.ts";
import { EventHasher } from "../../../../src/domain/events/EventHasher.ts";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { TypeVersion } from "../../../../src/domain/events/TypeVersion.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { AGENT, AT, SESSION, fact } from "../../../support/recordFixtures.ts";

// Un hecho de una versión futura: tipo desconocido, sellado detrás del último registro del stream.
function future(store: EventStore): EventRecord {
  const prev = store.readStream(SESSION).at(-1)!;
  const props = {
    id: EventId.of("session:s1:future.thing:x1"), stream: SESSION, version: StreamVersion.of(prev.version.value + 1), type: EventType.stored("future.thing"),
    typeVersion: TypeVersion.of(3), occurredAt: AT, recordedAt: AT, actor: AGENT, correlationId: prev.correlationId, causationId: prev.id,
    payload: CanonicalJson.of({ secret: "never read" }), prevHash: prev.hash,
  };
  return EventRecord.restore({ ...props, hash: EventHasher.compute(props) });
}

// El log con un hecho futuro en medio: opened, future.thing (importado ya sellado) y turn.completed detrás.
function seeded(store: EventStore): EventStore {
  store.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  assert.equal(store.importSealed([future(store)]), 1);
  store.append(SESSION, StreamVersion.of(2), [fact("turn.completed", "t1", { model: "m" }, SESSION, 2_000)], AT);
  return store;
}

test("EventType.stored conserva un tipo desconocido bien formado y rechaza uno mal formado", () => {
  assert.equal(EventType.stored("session.opened").known(), true);
  assert.ok(EventType.stored("session.opened").equals(EventType.of("session.opened")));
  const opaque = EventType.stored("future.thing");
  assert.equal(opaque.known(), false);
  assert.equal(opaque.value, "future.thing");
  assert.equal(opaque.belongsToSessions(), false);
  assert.throws(() => EventType.of("future.thing"), DomainError, "un hecho nuevo nunca lleva un tipo desconocido");
  for (const bad of ["future", "Future.x", "a..b", "a.b c", "", 7 as never]) assert.throws(() => EventType.stored(bad), DomainError, String(bad));
});

for (const [label, open] of [["memoria", () => new InMemoryEventStore()], ["sqlite", () => new SqliteEventStore(SqliteDatabase.open(":memory:"))]] as const) {
  test(`${label}: un tipo desconocido se lee opaco, la cadena se verifica y los append siguientes encadenan`, () => {
    const store = seeded(open());
    const records = store.readStream(SESSION);
    assert.deepEqual(records.map((r) => [r.type.value, r.type.known()]), [["session.opened", true], ["future.thing", false], ["turn.completed", true]]);
    assert.equal(records[1].typeVersion.value, 3);
    assert.ok(new VerifyEventLog(store).execute(SESSION)[0].result.isIntact());
  });
}

test("export → import de un log con un tipo desconocido lo conserva byte a byte", () => {
  const src = seeded(new SqliteEventStore(SqliteDatabase.open(":memory:")));
  const lines = new ExportEventLog(src, ProjectId.of("0123456789abcdef")).execute();
  const dst = new SqliteEventStore(SqliteDatabase.open(":memory:"));
  assert.equal(new ImportEventLog(dst, ProjectId.of("0123456789abcdef")).execute(lines).imported, 3);
  assert.deepEqual(dst.readStream(SESSION).map((r) => r.hash.value), src.readStream(SESSION).map((r) => r.hash.value));
  assert.ok(new VerifyEventLog(dst).execute().every((x) => x.result.isIntact()));
});

test("las proyecciones del host ignoran el tipo desconocido: nada en cuarentena", () => {
  const events = seeded(new InMemoryEventStore()); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, HostComposition.projections());
  runner.runOnce();
  for (const p of runner.projections()) {
    assert.deepEqual(store.quarantined(p.name), [], p.name.value);
    assert.equal(store.cursor(p.name)!.position.value, 3, p.name.value);
  }
});
