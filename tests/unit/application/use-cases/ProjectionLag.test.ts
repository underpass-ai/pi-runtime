import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionLag } from "../../../../src/application/use-cases/ProjectionLag.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { SessionSummaryProjection } from "../../../../src/application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../../../../src/application/projections/ToolStatsProjection.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../../src/domain/events/ProjectionCursor.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

test("log vacío: nada atrasado; con eventos sin proyectar: todas desde 0; al día: ninguna", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const list = [new SessionSummaryProjection(), new ToolStatsProjection()];
  const lag = new ProjectionLag(events, store, list);
  assert.deepEqual(lag.execute(), []);
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t")], AT);
  assert.deepEqual(lag.execute(), [{ projection: "session_summary", position: 0, last: 2 }, { projection: "tool_stats", position: 0, last: 2 }]);
  assert.deepEqual(lag.execute(ToolStatsProjection.NAME), [{ projection: "tool_stats", position: 0, last: 2 }]);
  new ProjectionRunner(events, store, list).runOnce();
  assert.deepEqual(lag.execute(), []);
});

test("cursor parcial informa su posición; cursor de otra versión cuenta desde 0", () => {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const p = new SessionSummaryProjection();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t")], AT);
  store.commit(p.name, ProjectionCursor.of(p.version, GlobalPosition.of(1)), new Map());
  assert.deepEqual(new ProjectionLag(events, store, [p]).execute(), [{ projection: "session_summary", position: 1, last: 2 }]);
  store.commit(p.name, ProjectionCursor.of(p.version + 1, GlobalPosition.of(2)), new Map());
  assert.deepEqual(new ProjectionLag(events, store, [p]).execute(), [{ projection: "session_summary", position: 0, last: 2 }]);
});
