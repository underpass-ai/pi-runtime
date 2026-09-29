import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
import { QualityKpisProjection } from "../../../../src/application/projections/QualityKpisProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { QualityKpisReport } from "../../../../src/application/use-cases/QualityKpisReport.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const S2 = StreamId.session(SessionId.of("s2"));
const tool = (about: string, name: string, status: string) => fact("tool.completed", about, { tool: name, server: "kmp", callId: about, status });

function world(events: EventStore): void {
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }),
    tool("a1", "kmp_ask", "failed"),
    tool("a2", "kmp_ask", "succeeded"),
    tool("a3", "kmp_search", "succeeded"),
    fact("turn.completed", "t1", { tokens: { input: 10, output: 5, cacheRead: 30, cacheWrite: 0 }, cost: 0.25 }),
    tool("b1", "kmp_ask", "succeeded"),
    tool("b2", "bash", "refused"),
    fact("turn.completed", "t2", { tokens: { input: 5, output: 1, cacheRead: 5 }, cost: 0.5 }),
    fact("context.compacted", "k", { reason: "threshold" }),
    fact("session.closed", "x", { reason: "quit" }),
    fact("session.opened", "o2", { reason: "resume" }),
  ], AT);
  events.append(S2, StreamVersion.NONE, [
    fact("session.opened", "o", {}, S2),
    fact("tool.completed", "c", { tool: "x", server: "pi", callId: "c", status: "succeeded" }, S2),
    fact("turn.completed", "t", { tokens: { input: 10, output: 3 }, cost: 0.25 }, S2),
  ], AT);
  events.append(StreamId.HOST, StreamVersion.NONE, [fact("host.started", "h", {}, StreamId.HOST)], AT);
}

const BACKENDS: [string, () => { events: EventStore; store: ProjectionStore }][] = [
  ["memoria", () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() })],
  ["sqlite", () => { const db = SqliteDatabase.open(":memory:"); return { events: new SqliteEventStore(db), store: new SqliteProjectionStore(db) }; }],
];

for (const [label, open] of BACKENDS) {
  test(`${label}: KPIs por sesión (éxito a la primera por turno, negativas, caché, compactaciones)`, () => {
    const { events, store } = open();
    world(events);
    new ProjectionRunner(events, store, [new QualityKpisProjection()]).runOnce();
    const s1 = new QualityKpisReport(store).execute(SessionId.of("s1"))!;
    assert.deepEqual(s1, { scope: "s1", sessions: 1, turns: 2, cost: 0.75, tokens: { input: 15, output: 6, cacheRead: 35, cacheWrite: 0 }, invocations: 5,
      firstTrySuccess: 0.5, refusalRate: 0.2, cacheRatio: 35 / 50, compactions: 1, compactionsPerSession: 1 });
    assert.equal(new QualityKpisReport(store).execute(SessionId.of("nadie")), null);
  });

  test(`${label}: KPIs globales; la reapertura no cuenta otra sesión`, () => {
    const { events, store } = open();
    world(events);
    new ProjectionRunner(events, store, [new QualityKpisProjection()]).runOnce();
    const g = new QualityKpisReport(store).execute()!;
    assert.deepEqual(g, { scope: "global", sessions: 2, turns: 3, cost: 1, tokens: { input: 25, output: 9, cacheRead: 35, cacheWrite: 0 }, invocations: 6,
      firstTrySuccess: 3 / 5, refusalRate: 1 / 6, cacheRatio: 35 / 60, compactions: 1, compactionsPerSession: 0.5 });
  });
}

test("sin datos: global con ratios null y ceros", () => {
  const g = new QualityKpisReport(new InMemoryProjectionStore()).execute()!;
  assert.deepEqual(g, { scope: "global", sessions: 0, turns: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, invocations: 0,
    firstTrySuccess: null, refusalRate: null, cacheRatio: null, compactions: 0, compactionsPerSession: null });
});

test("payloads inesperados cuentan como ausentes; el set de tools del turno está acotado", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o"),
    fact("turn.completed", "t", { tokens: "nope", cost: "gratis" }),
    fact("tool.completed", "c", { status: 1 }),
    ...Array.from({ length: 300 }, (_, i) => fact("tool.completed", `m${i}`, { tool: `t${i}`, status: "succeeded" })),
  ], AT);
  new ProjectionRunner(events, store, [new QualityKpisProjection()]).runOnce();
  const s = new QualityKpisReport(store).execute(SessionId.of("s1"))!;
  assert.deepEqual([s.turns, s.cost, s.tokens.input, s.invocations], [1, 0, 0, 301]);
  assert.ok((store.load(QualityKpisProjection.NAME).get("turn:s1") as string[]).length <= 256);
  assert.deepEqual(store.quarantined(QualityKpisProjection.NAME), []);
});
