import { test } from "node:test";
import assert from "node:assert/strict";
import { EventsCli } from "../../../../../src/adapters/inbound/cli/EventsCli.ts";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { QualityKpisProjection } from "../../../../../src/application/projections/QualityKpisProjection.ts";
import { TelemetryMetricsProjection } from "../../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { AcknowledgeSpoolGaps } from "../../../../../src/application/use-cases/AcknowledgeSpoolGaps.ts";
import { ExportEventLog } from "../../../../../src/application/use-cases/ExportEventLog.ts";
import { ImportEventLog } from "../../../../../src/application/use-cases/ImportEventLog.ts";
import { ListSessions } from "../../../../../src/application/use-cases/ListSessions.ts";
import { ProjectionLag } from "../../../../../src/application/use-cases/ProjectionLag.ts";
import { QualityKpisReport } from "../../../../../src/application/use-cases/QualityKpisReport.ts";
import { ReadTelemetryMetrics } from "../../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../../../../../src/application/use-cases/RebuildProjection.ts";
import { SessionTrace } from "../../../../../src/application/use-cases/SessionTrace.ts";
import { ShowSession } from "../../../../../src/application/use-cases/ShowSession.ts";
import { ToolStatsReport } from "../../../../../src/application/use-cases/ToolStatsReport.ts";
import { VerifyEventLog } from "../../../../../src/application/use-cases/VerifyEventLog.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { ProjectId } from "../../../../../src/domain/project/ProjectId.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

function cli() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 400, status: "succeeded" }, SESSION, 2400),
    fact("turn.completed", "t1", { model: "m", provider: "p", outcome: "completed", tokens: { input: 10, output: 3, cacheRead: 30, cacheWrite: 0 }, cost: 0.25, durationMs: 1500 }, SESSION, 3000),
    fact("tool.completed", "c2", { tool: "kmp_ask", server: "kmp", callId: "c2", durationMs: 20, status: "refused", errorCode: "invalid_argument" }, SESSION, 3100),
    fact("session.closed", "x", { reason: "quit" }, SESSION, 4000),
  ], AT);
  const list = [new QualityKpisProjection(), new TelemetryMetricsProjection()];
  const runner = new ProjectionRunner(events, store, list);
  runner.runOnce();
  const out: string[] = [];
  const project = ProjectId.of("0123456789abcdef");
  const c = new EventsCli({
    sessions: new ListSessions(store), show: new ShowSession(events), tools: new ToolStatsReport(store), kpis: new QualityKpisReport(store), trace: new SessionTrace(events),
    metrics: new ReadTelemetryMetrics(events, store), verify: new VerifyEventLog(events), exportLog: new ExportEventLog(events, project), importLog: new ImportEventLog(events, project),
    rebuild: new RebuildProjection(runner), lag: new ProjectionLag(events, store, list), ackGaps: new AcknowledgeSpoolGaps({ list: () => [], remove: () => {} }),
    readFile: () => "", print: (s) => out.push(s),
  });
  return { c, out };
}

test("kpis: tabla global con éxito a la primera, negativas, caché, compactaciones y latencia estimada por tool", () => {
  const { c, out } = cli();
  assert.equal(c.run(["kpis"]), 0);
  assert.deepEqual(out, [
    "scope        global",
    "sessions     1",
    "turns        1",
    "cost         0.2500",
    "tokens       input=10 output=3 cache_read=30 cache_write=0",
    "first-try    50.0%",
    "refusals     50.0% of 2 calls",
    "cache ratio  75.0%",
    "compactions  0 (0.00/session)",
    "latency      kmp/kmp_ask p50<=50ms p95<=500ms",
  ]);
  out.length = 0;
  assert.equal(c.run(["kpis", "--session", "s1"]), 0);
  assert.equal(out[0], "scope        s1");
  assert.equal(out.at(-1), "latency      kmp/kmp_ask p50<=50ms p95<=500ms");
  out.length = 0;
  assert.equal(c.run(["kpis", "--session", "nadie"]), 0);
  assert.deepEqual(out, ["no KPIs for session nadie"]);
});

test("trace: árbol de spans con duración, estado, tokens y coste por turno", () => {
  const { c, out } = cli();
  assert.equal(c.run(["trace", "s1"]), 0);
  assert.deepEqual(out, [
    "session  3000ms  unset  startup",
    "  turn  1500ms  unset  m completed  tokens=10+3  cost=0.2500",
    "    tool  400ms  unset  kmp/kmp_ask succeeded",
    "  tool  20ms  unset  kmp/kmp_ask refused",
  ]);
  out.length = 0;
  assert.equal(c.run(["trace", "nadie"]), 0);
  assert.deepEqual(out, ["no events for session nadie"]);
});

test("kpis y trace con uso incorrecto salen con 2", () => {
  const { c, out } = cli();
  for (const args of [["kpis", "x"], ["kpis", "--session"], ["trace"]]) {
    out.length = 0;
    assert.equal(c.run(args), 2, JSON.stringify(args));
    assert.match(out[0], /^usage: underpass events .*kpis \[--session s\]\|trace <session>/);
  }
});
