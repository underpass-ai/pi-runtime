import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import type { ProjectionState } from "../../../../src/application/services/ProjectionState.ts";
import type { Projection } from "../../../../src/application/ports/Projection.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { ProjectionName } from "../../../../src/domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../../../src/domain/events/StoredEvent.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

class Counter implements Projection {
  readonly name = ProjectionName.of("counter"); version: number; failOn: string | null = null;
  constructor(version = 1) { this.version = version; }
  apply(state: ProjectionState, e: StoredEvent): void {
    state.set("count", (state.get<number>("count") ?? 0) + 1);
    if (e.record.type.value === this.failOn) throw new Error("bad event");
  }
}

function seeded() {
  const events = new InMemoryEventStore();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("turn.completed", "t1"), fact("turn.completed", "t2")], AT);
  return events;
}

test("incremental igual a reconstrucción; un cambio de versión reconstruye", () => {
  const events = seeded(); const store = new InMemoryProjectionStore(); const p = new Counter();
  const runner = new ProjectionRunner(events, store, [p], 2);
  runner.runOnce();
  assert.equal(store.load(p.name).get("count"), 3);
  assert.equal(store.cursor(p.name)!.position.value, 3);
  runner.runOnce();
  assert.equal(store.load(p.name).get("count"), 3);
  runner.rebuild(p.name);
  assert.equal(store.load(p.name).get("count"), 3);
  const v2 = new Counter(2);
  new ProjectionRunner(events, store, [v2]).runOnce();
  assert.deepEqual([store.load(v2.name).get("count"), store.cursor(v2.name)!.version], [3, 2]);
  assert.throws(() => runner.rebuild(ProjectionName.of("missing")), /unknown projection/);
});

test("un evento que falla 3 veces va a cuarentena sin dejar cambios parciales y la proyección sigue", () => {
  const events = seeded(); const store = new InMemoryProjectionStore(); const p = new Counter(); p.failOn = "turn.completed";
  const runner = new ProjectionRunner(events, store, [p]);
  runner.runOnce(); runner.runOnce();
  assert.equal(store.load(p.name).get("count"), 1);
  assert.equal(store.quarantined(p.name).length, 0);
  runner.runOnce();
  assert.deepEqual(store.quarantined(p.name).map((q) => q.position.value), [2]);
  runner.runOnce(); runner.runOnce(); runner.runOnce();
  assert.deepEqual(store.quarantined(p.name).map((q) => q.position.value), [2, 3]);
  assert.equal(store.load(p.name).get("count"), 1);
  assert.equal(store.cursor(p.name)!.position.value, 3);
});
