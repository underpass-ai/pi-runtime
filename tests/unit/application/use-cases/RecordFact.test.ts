import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { AppendConflict } from "../../../../src/domain/events/AppendConflict.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { FixedClock } from "../../../support/FixedClock.ts";
import { SESSION, fact } from "../../../support/recordFixtures.ts";

test("registra, avisa tras el append, es idempotente y aplica decide", () => {
  const store = new InMemoryEventStore(); let after = 0;
  const uc = new RecordFact(store, new FixedClock(), () => { after++; });
  assert.throws(() => uc.execute(fact("turn.completed", "t")), /requires an open session/);
  const opened = fact("session.opened", "o");
  uc.execute(opened);
  uc.execute(fact("turn.completed", "t"));
  assert.ok(uc.execute(opened).idempotent);
  assert.equal(after, 2);
  assert.equal(store.readStream(SESSION).length, 2);
  assert.throws(() => uc.execute(fact("session.opened", "o", { reason: "other" })), DomainError);
  uc.execute(fact("host.started", "h", {}, StreamId.HOST));
  assert.equal(store.readStream(StreamId.HOST).length, 1);
});

test("reintenta ante conflicto de versión y se rinde tras 3", () => {
  const store = new InMemoryEventStore();
  const uc = new RecordFact(store, new FixedClock());
  uc.execute(fact("session.opened", "o"));
  let conflicts = 0;
  // Envoltorio explícito: Object.create(store) no sirve porque los campos # no se heredan.
  const withAppend = (append: EventStore["append"]): EventStore => ({ append, importSealed: (r) => store.importSealed(r), head: (s) => store.head(s),
    find: (s, i) => store.find(s, i), readStream: (s) => store.readStream(s), readAll: (a, l) => store.readAll(a, l), streams: () => store.streams(), lastPosition: () => store.lastPosition() });
  const flaky = withAppend((...a) => (conflicts++ < 2 ? AppendConflict.version(StreamVersion.NONE, StreamVersion.of(1)) : store.append(...a)));
  new RecordFact(flaky, new FixedClock()).execute(fact("turn.completed", "t1"));
  assert.equal(store.readStream(SESSION).length, 2);
  const always = withAppend(() => AppendConflict.version(StreamVersion.NONE, StreamVersion.of(1)));
  assert.throws(() => new RecordFact(always, new FixedClock()).execute(fact("turn.completed", "t2")), /after 3 attempts/);
});

test("un fallo de las proyecciones tras un append durable no convierte el registro en fallo: se informa y se devuelve el append", () => {
  const store = new InMemoryEventStore(); const reported: unknown[] = [];
  const uc = new RecordFact(store, new FixedClock(), () => { throw new Error("projection commit failed"); }, (e) => reported.push(e));
  const r = uc.execute(fact("session.opened", "o"));
  assert.equal(r.records.length, 1);
  assert.equal(store.readStream(SESSION).length, 1);
  assert.deepEqual(reported.map((e) => (e as Error).message), ["projection commit failed"]);
  assert.doesNotThrow(() => new RecordFact(store, new FixedClock(), () => { throw new Error("x"); }).execute(fact("turn.completed", "t")));
});

test("execute(fact, false) registra sin correr las proyecciones tras el append", () => {
  const store = new InMemoryEventStore(); let after = 0;
  const uc = new RecordFact(store, new FixedClock(), () => { after++; });
  uc.execute(fact("session.opened", "o"), false);
  assert.equal(after, 0);
  assert.equal(store.readStream(SESSION).length, 1);
  uc.execute(fact("turn.completed", "t"));
  assert.equal(after, 1);
});
