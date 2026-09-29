import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { SessionSummaryProjection } from "../../../../src/application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../../../../src/application/projections/ToolStatsProjection.ts";
import { ReadSessionSummary } from "../../../../src/application/use-cases/ReadSessionSummary.ts";
import { ListSessions } from "../../../../src/application/use-cases/ListSessions.ts";
import { ToolStatsReport } from "../../../../src/application/use-cases/ToolStatsReport.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

function world(events: EventStore, store: ProjectionStore) {
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }, SESSION, 1000),
    fact("phase.changed", "p", { from: null, to: "interactive" }),
    fact("turn.completed", "t1", { model: "m1", tokens: { input: 10, output: 4, cacheRead: 1, cacheWrite: 2 }, cost: 0.25, outcome: "completed" }),
    fact("turn.completed", "t2", { model: "m1", tokens: { input: 1, output: 1 }, cost: 0.5, outcome: "error" }),
    ...[100, 200, 300, 400].map((d, i) => fact("tool.completed", `c${i}`, { tool: "kmp_ask", server: "kmp", durationMs: d, status: i === 3 ? "refused" : "succeeded" })),
    fact("tool.completed", "c9", { tool: "bash", server: "pi", durationMs: 50, status: "failed" }),
    fact("session.closed", "x", { reason: "quit" }, SESSION, 9000),
  ], AT);
  events.append(StreamId.HOST, StreamVersion.NONE, [fact("host.started", "h", {}, StreamId.HOST)], AT);
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection(), new ToolStatsProjection()]);
  runner.runOnce();
  return { events, store, runner };
}

const BACKENDS: [string, () => { events: EventStore; store: ProjectionStore }][] = [
  ["memoria", () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() })],
  ["sqlite", () => { const db = SqliteDatabase.open(":memory:"); return { events: new SqliteEventStore(db), store: new SqliteProjectionStore(db) }; }],
];

for (const [label, open] of BACKENDS) {
  test(`${label}: resumen de sesión`, () => {
    const backend = open();
    const { store } = world(backend.events, backend.store);
    const s = new ReadSessionSummary(store).execute(SessionId.of("s1"))!;
    assert.deepEqual({ ...s, calls: undefined }, { sessionId: "s1", openedAt: "1970-01-01T00:00:01.000Z", closedAt: "1970-01-01T00:00:09.000Z", phase: "interactive", model: "m1",
      turns: 2, tokens: { input: 11, output: 5, cacheRead: 1, cacheWrite: 2 }, cost: 0.75, calls: undefined, failures: 2, lastEventAt: "1970-01-01T00:00:09.000Z" });
    assert.deepEqual(s.calls, { kmp: { succeeded: 3, refused: 1 }, pi: { failed: 1 } });
    assert.equal(new ReadSessionSummary(store).execute(SessionId.of("nope")), null);
    assert.deepEqual(new ListSessions(store).execute().map((x) => x.sessionId), ["s1"]);
  });

  test(`${label}: estadísticas por tool con percentiles`, () => {
    const { events, store } = open();
    world(events, store);
    const rows = new ToolStatsReport(store).execute();
    assert.deepEqual(rows.map((r) => [r.server, r.tool, r.n, r.succeeded, r.refused, r.failed, r.p50, r.p95]), [["kmp", "kmp_ask", 4, 3, 1, 0, 200, 400], ["pi", "bash", 1, 0, 0, 1, 50, 50]]);
  });

  test(`${label}: refresh se llama antes de leer`, () => {
    const { events, store } = open();
    world(events, store);
    let refreshed = 0;
    new ReadSessionSummary(store, () => { refreshed++; }).execute(SessionId.of("s1"));
    assert.equal(refreshed, 1);
  });
}

test("ListSessions ordena por openedAt descendente entre varias sesiones", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const s1 = StreamId.session(SessionId.of("s1")); const s2 = StreamId.session(SessionId.of("s2"));
  events.append(s1, StreamVersion.NONE, [fact("session.opened", "o1", {}, s1, 1000)], AT);
  events.append(s2, StreamVersion.NONE, [fact("session.opened", "o2", {}, s2, 5000)], AT);
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection(), new ToolStatsProjection()]);
  runner.runOnce();
  assert.deepEqual(new ListSessions(store).execute().map((x) => x.sessionId), ["s2", "s1"]);
});

test("lecturas sobre un store vacío devuelven vacío/null (rutas de fallo)", () => {
  const store = new InMemoryProjectionStore();
  assert.equal(new ReadSessionSummary(store).execute(SessionId.of("s1")), null);
  assert.deepEqual(new ListSessions(store).execute(), []);
  assert.deepEqual(new ToolStatsReport(store).execute(), []);
});

test("reapertura implícita (session.opened con la sesión abierta tras caerse Pi): openedAt es el primero, closedAt se borra y los contadores siguen sin reiniciarse ni duplicarse", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection()]);
  const turn = (about: string, ms: number) => fact("turn.completed", about, { model: "m1", tokens: { input: 1, output: 1 }, cost: 0.5 }, SESSION, ms);
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o1", { reason: "startup" }, SESSION, 1000), turn("t1", 2000)], AT);
  runner.runOnce();
  events.append(SESSION, StreamVersion.of(2), [fact("session.opened", "o2", { reason: "resume" }, SESSION, 3000)], AT);
  runner.runOnce();
  const reopened = new ReadSessionSummary(store).execute(SessionId.of("s1"))!;
  assert.deepEqual([reopened.openedAt, reopened.closedAt, reopened.turns], ["1970-01-01T00:00:01.000Z", null, 1]);
  events.append(SESSION, StreamVersion.of(3), [turn("t2", 4000), fact("session.closed", "c", { reason: "quit" }, SESSION, 5000)], AT);
  runner.runOnce();
  const s = new ReadSessionSummary(store).execute(SessionId.of("s1"))!;
  assert.deepEqual([s.openedAt, s.closedAt, s.turns, s.tokens.input, s.cost], ["1970-01-01T00:00:01.000Z", "1970-01-01T00:00:05.000Z", 2, 2, 1]);
  // Reconstruir desde cero da lo mismo que el procesamiento incremental.
  const rebuilt = new InMemoryProjectionStore();
  new ProjectionRunner(events, rebuilt, [new SessionSummaryProjection()]).runOnce();
  assert.deepEqual(new ReadSessionSummary(rebuilt).execute(SessionId.of("s1")), s);
});

test("session_summary va por la versión 2: el cambio de openedAt reconstruye los resúmenes ya persistidos", () => {
  assert.equal(new SessionSummaryProjection().version, 2);
});
