import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadSessionStatus } from "../../../../src/application/use-cases/ReadSessionStatus.ts";
import { ReadSessionSummary } from "../../../../src/application/use-cases/ReadSessionSummary.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { SessionSummaryProjection } from "../../../../src/application/projections/SessionSummaryProjection.ts";
import { QualityKpisProjection } from "../../../../src/application/projections/QualityKpisProjection.ts";
import { QualityKpisReport } from "../../../../src/application/use-cases/QualityKpisReport.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { FixedClock } from "../../../support/FixedClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

function log() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection()]);
  const record = new RecordFact(events, new FixedClock());
  record.execute(fact("session.opened", "open", { reason: "startup" }));
  record.execute(fact("session.closed", "closed", { reason: "quit" }));
  record.execute(fact("host.started", "h", { version: "0.1.0", pid: 1 }, StreamId.HOST));
  return { events, summaries: new ReadSessionSummary(store, () => runner.runOnce()) };
}

test("estado de una sesión íntegra: resumen, posición del log y cadena intacta", () => {
  const { events, summaries } = log();
  const s = new ReadSessionStatus(events, summaries).execute(SessionId.of("s1"));
  assert.equal(s.summary?.sessionId, "s1");
  assert.deepEqual([s.logPosition, s.sessionChainIntact], [3, true]);
});

test("sesión desconocida: resumen nulo y cadena intacta; una cadena rota se informa", () => {
  const { events, summaries } = log();
  assert.deepEqual(new ReadSessionStatus(events, summaries).execute(SessionId.of("otra")), { summary: null, logPosition: 3, sessionChainIntact: true });
  const tampered = { lastPosition: () => events.lastPosition(), readStream: (s: StreamId) => events.readStream(s).slice(1) } as unknown as EventStore;
  assert.equal(new ReadSessionStatus(tampered, summaries).execute(SessionId.of("s1")).sessionChainIntact, false);
});

test("con KPIs y exportador, el estado añade los KPIs de la sesión y el del exportador", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection(), new QualityKpisProjection()]);
  const record = new RecordFact(events, new FixedClock());
  record.execute(fact("session.opened", "open", { reason: "startup" }));
  record.execute(fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", status: "succeeded" }));
  const exporter = { state: "failing" as const, lag: 4, since: "1970-01-01T00:00:10.000Z" };
  const s = new ReadSessionStatus(events, new ReadSessionSummary(store, () => runner.runOnce()), new QualityKpisReport(store), () => exporter).execute(SessionId.of("s1"));
  assert.equal(s.kpis?.firstTrySuccess, 1);
  assert.deepEqual(s.exporter, exporter);
  assert.equal(new ReadSessionStatus(events, new ReadSessionSummary(store), new QualityKpisReport(store)).execute(SessionId.of("otra")).kpis, null);
});

test("sin KPIs ni exportador cableados el estado no lleva esos campos (como un host anterior)", () => {
  const { events, summaries } = log();
  const s = new ReadSessionStatus(events, summaries).execute(SessionId.of("s1"));
  assert.equal("kpis" in s, false);
  assert.equal("exporter" in s, false);
});
