import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteProjectionStore } from "../../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { ProjectionName } from "../../../../../src/domain/events/ProjectionName.ts";
import { ProjectionCursor } from "../../../../../src/domain/events/ProjectionCursor.ts";
import { GlobalPosition } from "../../../../../src/domain/events/GlobalPosition.ts";
import type { ProjectionStore } from "../../../../../src/application/ports/ProjectionStore.ts";

for (const [label, open] of [["sqlite", () => new SqliteProjectionStore(SqliteDatabase.open(":memory:"))], ["memoria", () => new InMemoryProjectionStore()]] as [string, () => ProjectionStore][]) {
  test(`${label}: commit atómico, reset y cuarentena`, () => {
    const s = open(); const n = ProjectionName.of("p");
    assert.equal(s.cursor(n), null);
    s.commit(n, ProjectionCursor.of(1, GlobalPosition.of(4)), new Map<string, unknown>([["a", { x: 1 }], ["b", 2]]));
    assert.deepEqual([s.cursor(n)!.version, s.cursor(n)!.position.value], [1, 4]);
    assert.deepEqual(Object.fromEntries(s.load(n)), { a: { x: 1 }, b: 2 });
    s.quarantine(n, GlobalPosition.of(3), "bad");
    assert.deepEqual(s.quarantined(n).map((q) => [q.position.value, q.reason]), [[3, "bad"]]);
    s.reset(n, 2);
    assert.deepEqual([s.cursor(n)!.version, s.cursor(n)!.position.value, s.load(n).size, s.quarantined(n).length], [2, 0, 0, 0]);
  });
}

test("ProjectionName valida", () => {
  assert.throws(() => ProjectionName.of("Bad-Name"));
  assert.throws(() => ProjectionName.of(undefined as never));
});

test("ProjectionCursor.of valida versión (éxito y fallo)", () => {
  const c = ProjectionCursor.of(1, GlobalPosition.of(4));
  assert.deepEqual([c.version, c.position.value], [1, 4]);
  assert.throws(() => ProjectionCursor.of(0, GlobalPosition.START));
  assert.throws(() => ProjectionCursor.of(1.5, GlobalPosition.START));
});
