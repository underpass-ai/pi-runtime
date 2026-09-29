import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventStore } from "../../src/application/ports/EventStore.ts";
import { Appended } from "../../src/domain/events/Appended.ts";
import { AppendConflict } from "../../src/domain/events/AppendConflict.ts";
import { ContinuationSealer } from "../../src/domain/events/ContinuationSealer.ts";
import { GlobalPosition } from "../../src/domain/events/GlobalPosition.ts";
import { StreamVerifier } from "../../src/domain/events/StreamVerifier.ts";
import { StreamVersion } from "../../src/domain/events/StreamVersion.ts";
import { StreamId } from "../../src/domain/events/StreamId.ts";
import { AT, SESSION, fact } from "./recordFixtures.ts";

export function eventStoreConformance(label: string, open: () => EventStore): void {
  test(`${label}: versiones contiguas, cabeza y cadena íntegra`, () => {
    const s = open();
    assert.equal(s.head(SESSION), null);
    const a = s.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t1")], AT);
    assert.ok(a instanceof Appended && a.records.length === 2);
    const b = s.append(SESSION, StreamVersion.of(2), [fact("turn.completed", "t2")], AT);
    assert.ok(b instanceof Appended);
    assert.equal(s.head(SESSION)!.version.value, 3);
    assert.deepEqual(s.readStream(SESSION).map((r) => r.version.value), [1, 2, 3]);
    assert.ok(StreamVerifier.verify(s.readStream(SESSION)).isIntact());
  });

  test(`${label}: versión obsoleta es un conflicto que no escribe nada`, () => {
    const s = open();
    s.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
    const c = s.append(SESSION, StreamVersion.NONE, [fact("turn.completed", "t")], AT);
    assert.ok(c instanceof AppendConflict && c.reason === "version" && c.actual.value === 1);
    assert.equal(s.readStream(SESSION).length, 1);
  });

  test(`${label}: idempotencia por event_id y divergencia`, () => {
    const s = open();
    const f = fact("session.opened", "o", { reason: "startup" });
    s.append(SESSION, StreamVersion.NONE, [f], AT);
    const again = s.append(SESSION, StreamVersion.NONE, [f], AT);
    assert.ok(again instanceof Appended && again.idempotent);
    assert.equal(s.readStream(SESSION).length, 1);
    const d = s.append(SESSION, StreamVersion.of(1), [fact("session.opened", "o", { reason: "resume" })], AT);
    assert.ok(d instanceof AppendConflict && d.reason === "diverged");
    assert.ok(s.find(SESSION, f.id)!.matches(f));
  });

  test(`${label}: readAll ordenado, paginado y estable entre streams`, () => {
    const s = open();
    s.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
    s.append(StreamId.HOST, StreamVersion.NONE, [fact("host.started", "h", {}, StreamId.HOST)], AT);
    s.append(SESSION, StreamVersion.of(1), [fact("turn.completed", "t")], AT);
    const all = s.readAll(GlobalPosition.START, 10);
    assert.deepEqual(all.map((e) => e.record.type.value), ["session.opened", "host.started", "turn.completed"]);
    assert.deepEqual(all.map((e) => e.position.value), [1, 2, 3]);
    assert.deepEqual(s.readAll(all[0].position, 1).map((e) => e.position.value), [2]);
    assert.equal(s.lastPosition().value, 3);
    assert.deepEqual(s.streams().map(String).sort(), ["host", "session:s1"]);
  });

  test(`${label}: importSealed escribe la cola y rechaza la divergencia sin escribir`, () => {
    const s = open();
    const all = ContinuationSealer.seal(null, [fact("session.opened", "o"), fact("turn.completed", "t1")], AT);
    assert.equal(s.importSealed(all.slice(0, 1)), 1);
    assert.equal(s.importSealed(all), 1);
    assert.equal(s.importSealed(all), 0);
    const other = ContinuationSealer.seal(null, [fact("session.opened", "o", { reason: "x" })], AT);
    assert.throws(() => s.importSealed(other), /diverges/);
    assert.equal(s.readStream(SESSION).length, 2);
  });
}
