import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadSessionStatus } from "../../../../src/application/use-cases/ReadSessionStatus.ts";
import { ReadSessionSummary } from "../../../../src/application/use-cases/ReadSessionSummary.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { SessionSummaryProjection } from "../../../../src/application/projections/SessionSummaryProjection.ts";
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
