import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SqliteDatabase } from "../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { ReadTelemetryMetrics } from "../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import type { MetricsSnapshot } from "../../../../src/domain/telemetry/MetricsSnapshot.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const S2 = StreamId.session(SessionId.of("s2"));

function world(events: EventStore): void {
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o1", { reason: "startup" }),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 40, status: "succeeded" }),
    fact("tool.completed", "c2", { tool: "kmp_ingest", server: "kmp", callId: "c2", durationMs: 700, status: "refused", errorCode: "invalid_argument" }),
    fact("tool.completed", "c3", { tool: "bash", server: "pi", callId: "c3", status: "failed", errorKind: "tool_error" }),
    fact("tool.completed", "c4", { tool: "weird tool/../x", server: "pi", callId: "c4", durationMs: 90_000, status: "exploded" }),
    fact("turn.completed", "t1", { model: "m1", provider: "p1", tokens: { input: 10, output: 4, cacheRead: 6, cacheWrite: 1 }, cost: 0.25, outcome: "completed" }),
    fact("turn.completed", "t2", { model: "m1", provider: "p1", tokens: { input: 2 }, cost: 0.5, outcome: "error" }),
    fact("context.compacted", "k1", { tokensBefore: 100, tokensAfter: 10, reason: "threshold" }),
    fact("session.closed", "x1", { reason: "quit" }),
    fact("session.opened", "o2", { reason: "resume" }),
  ], AT);
  events.append(S2, StreamVersion.NONE, [fact("session.opened", "o", { reason: "startup" }, S2)], AT);
  events.append(StreamId.HOST, StreamVersion.NONE, [
    fact("host.started", "h1", { version: "0.1.0", pid: 1 }, StreamId.HOST),
    fact("server.started", "k1", { server: "kmp", name: "kmp", version: "1.0.0" }, StreamId.HOST),
    fact("server.exited", "k2", { server: "kmp", code: 137 }, StreamId.HOST),
    fact("server.exited", "k3", { server: "made", code: null }, StreamId.HOST),
  ], AT);
}

const flat = (s: MetricsSnapshot) => Object.fromEntries(s.points().map((p) => [`${p.key.descriptor.name}{${p.key.labels.text}}`, p.histogram ? p.histogram.toJson() : p.value]));
const zeros = (i: number) => { const b = new Array(11).fill(0); if (i >= 0) b[i] = 1; return b; };

const EXPECTED = {
  "pi_runtime_tool_invocations_total{server=kmp,status=succeeded,tool=kmp_ask}": 1,
  "pi_runtime_tool_invocations_total{server=kmp,status=refused,tool=kmp_ingest}": 1,
  "pi_runtime_tool_invocations_total{server=pi,status=failed,tool=bash}": 1,
  "pi_runtime_tool_invocations_total{server=pi,status=unknown,tool=other}": 1,
  "pi_runtime_tool_refused_total{reason=invalid_argument,tool=kmp_ingest}": 1,
  "pi_runtime_tool_duration_ms{server=kmp,tool=kmp_ask}": { buckets: zeros(1), sum: 40, count: 1 },
  "pi_runtime_tool_duration_ms{server=kmp,tool=kmp_ingest}": { buckets: zeros(5), sum: 700, count: 1 },
  "pi_runtime_tool_duration_ms{server=pi,tool=other}": { buckets: zeros(-1), sum: 90_000, count: 1 },
  "pi_runtime_turns_total{model=m1,outcome=completed,provider=p1}": 1,
  "pi_runtime_turns_total{model=m1,outcome=error,provider=p1}": 1,
  "pi_runtime_tokens_total{kind=input,model=m1,provider=p1}": 12,
  "pi_runtime_tokens_total{kind=output,model=m1,provider=p1}": 4,
  "pi_runtime_tokens_total{kind=cache_read,model=m1,provider=p1}": 6,
  "pi_runtime_tokens_total{kind=cache_write,model=m1,provider=p1}": 1,
  "pi_runtime_cost_total{model=m1,provider=p1}": 0.75,
  "pi_runtime_sessions_total{event=opened}": 2,
  "pi_runtime_sessions_total{event=closed}": 1,
  "pi_runtime_sessions_total{event=reopened}": 1,
  "pi_runtime_compactions_total{reason=threshold}": 1,
  "pi_runtime_server_starts_total{server=kmp}": 1,
  "pi_runtime_server_exits_total{code=137,server=kmp}": 1,
  "pi_runtime_server_exits_total{code=unknown,server=made}": 1,
};

const BACKENDS: [string, () => { events: EventStore; store: ProjectionStore }][] = [
  ["memoria", () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() })],
  ["sqlite", () => { const db = SqliteDatabase.open(":memory:"); return { events: new SqliteEventStore(db), store: new SqliteProjectionStore(db) }; }],
];

for (const [label, open] of BACKENDS) {
  test(`${label}: contadores e histograma acumulados con labels acotados`, () => {
    const { events, store } = open();
    world(events);
    new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
    assert.deepEqual(flat(new ReadTelemetryMetrics(events, store).execute()), EXPECTED);
    assert.deepEqual(store.quarantined(TelemetryMetricsProjection.NAME), []);
  });

  test(`${label}: --session reproduce sólo el stream de esa sesión`, () => {
    const { events, store } = open();
    world(events);
    const read = new ReadTelemetryMetrics(events, store);
    assert.deepEqual(flat(read.execute(SessionId.of("s2"))), { "pi_runtime_sessions_total{event=opened}": 1 });
    const s1 = flat(read.execute(SessionId.of("s1")));
    assert.equal(s1["pi_runtime_sessions_total{event=reopened}"], 1);
    assert.equal(s1["pi_runtime_server_starts_total{server=kmp}"], undefined);
    assert.ok(read.execute(SessionId.of("nadie")).isEmpty());
  });
}

test("incremental y reconstrucción dan lo mismo; el orden del snapshot sigue al catálogo", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new TelemetryMetricsProjection()], 2);
  world(events);
  runner.runOnce();
  const incremental = flat(new ReadTelemetryMetrics(events, store).execute());
  runner.rebuild(TelemetryMetricsProjection.NAME);
  assert.deepEqual(flat(new ReadTelemetryMetrics(events, store).execute()), incremental);
  const groups = new ReadTelemetryMetrics(events, store).execute().byDescriptor().map((g) => g.descriptor.name);
  assert.deepEqual(groups, ["pi_runtime_tool_invocations_total", "pi_runtime_tool_refused_total", "pi_runtime_tool_duration_ms", "pi_runtime_turns_total",
    "pi_runtime_tokens_total", "pi_runtime_cost_total", "pi_runtime_sessions_total", "pi_runtime_compactions_total", "pi_runtime_server_starts_total", "pi_runtime_server_exits_total"]);
});

test("payloads inesperados cuentan como dato ausente, sin cuarentena", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o"),
    fact("turn.completed", "t", { tokens: "nope", cost: "free", model: { x: 1 } }),
    fact("tool.completed", "c", { durationMs: -5, status: 3 }),
  ], AT);
  new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
  const m = flat(new ReadTelemetryMetrics(events, store).execute());
  assert.equal(m["pi_runtime_turns_total{model=other,outcome=unknown,provider=unknown}"], 1);
  assert.equal(m["pi_runtime_tokens_total{kind=input,model=other,provider=unknown}"], 0);
  assert.equal(m["pi_runtime_cost_total{model=other,provider=unknown}"], 0);
  assert.equal(m["pi_runtime_tool_invocations_total{server=unknown,status=unknown,tool=unknown}"], 1);
  assert.equal(Object.keys(m).some((k) => k.startsWith("pi_runtime_tool_duration_ms")), false);
  assert.deepEqual(store.quarantined(TelemetryMetricsProjection.NAME), []);
});
