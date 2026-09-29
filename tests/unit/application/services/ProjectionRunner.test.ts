import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import type { ProjectionState } from "../../../../src/application/services/ProjectionState.ts";
import type { Projection } from "../../../../src/application/ports/Projection.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
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

// Hallazgo final 3: `events rebuild` del CLI corriendo a la vez que el runner
// del host. El rebuild termina entre la lectura del cursor del host y la carga
// de su estado: sin compare-and-set el host aplicaba otra vez los 3 eventos
// sobre el estado ya reconstruido (count 6).
test("rebuild concurrente con una pasada del host: sin doble aplicación", () => {
  const events = seeded(); const shared = new InMemoryProjectionStore();
  const cli = new ProjectionRunner(events, shared, [new Counter()]);
  let armed = true;
  const interleave = (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => { if (armed) { armed = false; cli.rebuild(ProjectionName.of("counter")); } return fn(...a); };
  const hostStore = new Proxy(shared, { get(t, k) {
    const v = (t as unknown as Record<string | symbol, unknown>)[k];
    const bound = typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    return k === "load" || k === "snapshot" ? interleave(bound as (...a: unknown[]) => unknown) : bound;
  } });
  new ProjectionRunner(events, hostStore, [new Counter()]).runOnce();
  assert.equal(shared.load(ProjectionName.of("counter")).get("count"), 3);
});

const delegate = (inner: InMemoryProjectionStore): ProjectionStore => ({
  cursor: (n) => inner.cursor(n), load: (n) => inner.load(n), snapshot: (n) => inner.snapshot(n), commit: (...a) => inner.commit(...a),
  reset: (n, v) => inner.reset(n, v), quarantine: (...a) => inner.quarantine(...a), quarantined: (n) => inner.quarantined(n),
});

test("un commit rechazado por cursor obsoleto se reintenta desde el estado recargado", () => {
  const events = seeded(); const inner = new InMemoryProjectionStore(); let stale = 1;
  const store = Object.assign(delegate(inner), {
    commit: (...a: Parameters<InMemoryProjectionStore["commit"]>) => {
      if (stale-- > 0) { new ProjectionRunner(events, inner, [new Counter()]).runOnce(); return false; } // otro escritor gana la carrera
      return inner.commit(...a);
    },
  });
  new ProjectionRunner(events, store, [new Counter()]).runOnce();
  assert.deepEqual([inner.load(ProjectionName.of("counter")).get("count"), inner.cursor(ProjectionName.of("counter"))!.position.value], [3, 3]);
});

test("un cursor que nunca cuadra se abandona tras unos intentos sin lanzar", () => {
  const events = seeded(); const inner = new InMemoryProjectionStore(); let attempts = 0;
  const store = Object.assign(delegate(inner), { commit: () => { attempts++; return false; } });
  assert.doesNotThrow(() => new ProjectionRunner(events, store, [new Counter()]).runOnce());
  assert.equal(attempts, 3);
});

test("un valor que no es JSON falla dentro de apply (camino de cuarentena), no al hacer commit", async () => {
  const { SqliteDatabase } = await import("../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts");
  const { SqliteProjectionStore } = await import("../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts");
  class BigIntOnTurn implements Projection {
    readonly name = ProjectionName.of("bigint"); readonly version = 1;
    apply(state: ProjectionState, e: StoredEvent): void { state.set(e.record.type.value, e.record.type.value === "turn.completed" ? 1n : 1); }
  }
  const events = seeded(); const store = new SqliteProjectionStore(SqliteDatabase.open(":memory:")); const runner = new ProjectionRunner(events, store, [new BigIntOnTurn()]);
  for (let i = 0; i < 6; i++) assert.doesNotThrow(() => runner.runOnce());
  assert.deepEqual(store.quarantined(ProjectionName.of("bigint")).map((q) => q.position.value), [2, 3]);
  assert.deepEqual(Object.fromEntries(store.load(ProjectionName.of("bigint"))), { "session.opened": 1 });
});
