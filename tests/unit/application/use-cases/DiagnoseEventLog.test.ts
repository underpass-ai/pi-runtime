import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagnoseEventLog } from "../../../../src/application/use-cases/DiagnoseEventLog.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { SessionSummaryProjection } from "../../../../src/application/projections/SessionSummaryProjection.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import type { Projection } from "../../../../src/application/ports/Projection.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../../src/domain/events/ProjectionCursor.ts";
import type { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const spool = (pendingFiles = 0, gaps = 0) => ({ inspect: () => ({ pendingFiles, gaps }) });
const row = (checks: { name: { value: string }; status: { value: string }; detail: { value: string } }[], n: string) => checks.find((c) => c.name.value === n)!;

test("log vacío: warn; con eventos y proyecciones al día: ok", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const projs = [new SessionSummaryProjection()];
  assert.equal(row(new DiagnoseEventLog(events, store, projs, spool()).execute(), "event log").status.value, "WARN");
  assert.match(row(new DiagnoseEventLog(events, store, projs, spool()).execute(), "event log").detail.value, /no events recorded yet/);
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  assert.equal(row(new DiagnoseEventLog(events, store, projs, spool()).execute(), "projections").status.value, "WARN");
  new ProjectionRunner(events, store, projs).runOnce();
  const checks = new DiagnoseEventLog(events, store, projs, spool()).execute();
  assert.deepEqual(["event log", "event chain", "projections", "projection quarantine", "fact spool"].map((n) => row(checks, n).status.value), ["OK", "OK", "OK", "OK", "OK"]);
  assert.ok(checks.every((c) => c.section.value === "events"));
  assert.equal(row(checks, "event log").detail.value, "1 events, 1 streams");
  assert.equal(row(checks, "event chain").detail.value, "all streams intact");
  assert.equal(row(checks, "projections").detail.value, "up to date");
  assert.equal(row(checks, "fact spool").detail.value, "empty");
});

test("proyección atrasada o de otra versión avisa con su detalle", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const projs: Projection[] = [new SessionSummaryProjection()];
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t1")], AT);
  assert.match(row(new DiagnoseEventLog(events, store, projs, spool()).execute(), "projections").detail.value, /session_summary version mismatch/);
  store.reset(projs[0].name, projs[0].version); store.commit(projs[0].name, ProjectionCursor.of(projs[0].version, GlobalPosition.START), ProjectionCursor.of(projs[0].version, GlobalPosition.of(1)), new Map());
  assert.equal(row(new DiagnoseEventLog(events, store, projs, spool()).execute(), "projections").detail.value, "session_summary at 1/2 (behind)");
  store.reset(projs[0].name, projs[0].version + 1); store.commit(projs[0].name, ProjectionCursor.of(projs[0].version + 1, GlobalPosition.START), ProjectionCursor.of(projs[0].version + 1, GlobalPosition.of(2)), new Map());
  assert.match(row(new DiagnoseEventLog(events, store, projs, spool()).execute(), "projections").detail.value, /version mismatch/);
});

test("spool pendiente avisa, huecos fallan y la cuarentena avisa", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const projs = [new SessionSummaryProjection()];
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o")], AT);
  store.quarantine(projs[0].name, GlobalPosition.of(1), "x");
  const checks = new DiagnoseEventLog(events, store, projs, spool(2, 1)).execute();
  assert.equal(row(checks, "fact spool").status.value, "FAIL");
  assert.equal(row(checks, "fact spool").detail.value, "1 spool overflow gap(s): facts were lost");
  assert.equal(row(checks, "projection quarantine").status.value, "WARN");
  assert.equal(row(checks, "projection quarantine").detail.value, "1 quarantined events");
  const pending = row(new DiagnoseEventLog(events, store, projs, spool(2, 0)).execute(), "fact spool");
  assert.deepEqual([pending.status.value, pending.detail.value], ["WARN", "2 pending spool file(s)"]);
});

class TamperedStore implements EventStore {
  readonly #inner: EventStore;
  constructor(inner: EventStore) { this.#inner = inner; }
  append(...a: Parameters<EventStore["append"]>) { return this.#inner.append(...a); }
  importSealed(...a: Parameters<EventStore["importSealed"]>) { return this.#inner.importSealed(...a); }
  head(...a: Parameters<EventStore["head"]>) { return this.#inner.head(...a); }
  find(...a: Parameters<EventStore["find"]>) { return this.#inner.find(...a); }
  readAll(...a: Parameters<EventStore["readAll"]>) { return this.#inner.readAll(...a); }
  streams() { return this.#inner.streams(); }
  lastPosition() { return this.#inner.lastPosition(); }
  readStream(s: StreamId): EventRecord[] {
    return this.#inner.readStream(s).map((r, i) => (i === 1 ? EventRecord.restore({ ...r, payload: CanonicalJson.of({ x: 1 }) }) : r));
  }
}

test("cadena rota: FAIL en 'event chain' con stream y versión", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const projs = [new SessionSummaryProjection()];
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t1")], AT);
  const chain = row(new DiagnoseEventLog(new TamperedStore(events), store, projs, spool()).execute(), "event chain");
  assert.equal(chain.status.value, "FAIL");
  assert.match(chain.detail.value, /^session:s1 broken at v2: /);
});
