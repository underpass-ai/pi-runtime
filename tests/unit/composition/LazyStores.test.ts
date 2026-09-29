import { test } from "node:test";
import assert from "node:assert/strict";
import { LazyEventStore } from "../../../src/composition/LazyEventStore.ts";
import { LazyProjectionStore } from "../../../src/composition/LazyProjectionStore.ts";
import { InMemoryEventStore } from "../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { GlobalPosition } from "../../../src/domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../src/domain/events/ProjectionCursor.ts";
import { ProjectionName } from "../../../src/domain/events/ProjectionName.ts";
import { StreamVersion } from "../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../support/recordFixtures.ts";

test("LazyEventStore no resuelve hasta el primer uso y delega cada método", () => {
  let resolved = 0; const inner = new InMemoryEventStore();
  const s = new LazyEventStore(() => { resolved++; return inner; });
  assert.equal(resolved, 0);
  const f = fact("session.opened", "o");
  s.append(SESSION, StreamVersion.NONE, [f], AT);
  assert.equal(s.lastPosition().value, 1);
  assert.equal(s.head(SESSION)!.version.value, 1);
  assert.ok(s.find(SESSION, f.id));
  assert.equal(s.readStream(SESSION).length, 1);
  assert.equal(s.readAll(GlobalPosition.START, 10).length, 1);
  assert.deepEqual(s.streams().map(String), ["session:s1"]);
  assert.equal(s.importSealed(inner.readStream(SESSION)), 0);
  assert.ok(resolved > 0);
});

test("LazyProjectionStore no resuelve hasta el primer uso y delega cada método", () => {
  let resolved = 0; const inner = new InMemoryProjectionStore(); const name = ProjectionName.of("p");
  const s = new LazyProjectionStore(() => { resolved++; return inner; });
  assert.equal(resolved, 0);
  s.commit(name, ProjectionCursor.of(1, GlobalPosition.of(2)), new Map([["k", 1]]));
  assert.equal(s.cursor(name)!.position.value, 2);
  assert.deepEqual([...s.load(name)], [["k", 1]]);
  s.quarantine(name, GlobalPosition.of(1), "x");
  assert.equal(s.quarantined(name).length, 1);
  s.reset(name, 1);
  assert.equal(s.load(name).size, 0);
});
