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
    assert.equal(s.commit(n, ProjectionCursor.of(1, GlobalPosition.START), ProjectionCursor.of(1, GlobalPosition.of(4)), new Map<string, unknown>([["a", { x: 1 }], ["b", 2]])), true);
    assert.deepEqual([s.cursor(n)!.version, s.cursor(n)!.position.value], [1, 4]);
    assert.deepEqual(Object.fromEntries(s.load(n)), { a: { x: 1 }, b: 2 });
    s.quarantine(n, GlobalPosition.of(3), "bad");
    assert.deepEqual(s.quarantined(n).map((q) => [q.position.value, q.reason]), [[3, "bad"]]);
    s.reset(n, 2);
    assert.deepEqual([s.cursor(n)!.version, s.cursor(n)!.position.value, s.load(n).size, s.quarantined(n).length], [2, 0, 0, 0]);
  });

  test(`${label}: commit con compare-and-set; un cursor obsoleto no escribe nada`, () => {
    const s = open(); const n = ProjectionName.of("p"); const at = (p: number, v = 1) => ProjectionCursor.of(v, GlobalPosition.of(p));
    assert.equal(s.commit(n, at(2), at(3), new Map([["k", 1]])), false, "sin fila sólo se acepta el cursor inicial");
    assert.equal(s.cursor(n), null);
    assert.equal(s.commit(n, at(0), at(3), new Map([["k", 3]])), true);
    assert.equal(s.commit(n, at(0), at(5), new Map([["k", 99]])), false, "otro escritor ya movió el cursor");
    assert.deepEqual([s.cursor(n)!.position.value, s.load(n).get("k")], [3, 3]);
    assert.equal(s.commit(n, at(3, 2), at(5, 2), new Map()), false, "la versión también cuenta");
    assert.equal(s.commit(n, at(3), at(5), new Map([["k", 5]])), true);
    s.reset(n, 1);
    assert.equal(s.commit(n, at(5), at(6), new Map([["k", 6]])), false, "reset invalida las pasadas en vuelo");
    assert.deepEqual([s.cursor(n)!.position.value, s.load(n).size], [0, 0]);
    const snap = s.snapshot(n);
    assert.deepEqual([snap.cursor!.position.value, snap.state.size], [0, 0]);
    s.commit(n, at(0), at(2), new Map([["k", { deep: [1] }]]));
    const again = s.snapshot(n);
    assert.deepEqual([again.cursor!.position.value, Object.fromEntries(again.state)], [2, { k: { deep: [1] } }]);
    assert.deepEqual(s.snapshot(ProjectionName.of("otra")), { cursor: null, state: new Map() });
  });

  test(`${label}: la cuarentena es idempotente por posición (la última razón gana)`, () => {
    const s = open(); const n = ProjectionName.of("p");
    s.quarantine(n, GlobalPosition.of(7), "primera"); s.quarantine(n, GlobalPosition.of(2), "otra"); s.quarantine(n, GlobalPosition.of(7), "segunda");
    assert.deepEqual(s.quarantined(n).map((q) => [q.position.value, q.reason]), [[2, "otra"], [7, "segunda"]]);
  });
}

test("sqlite: un reset desde otra conexión invalida el commit en vuelo de la primera", async () => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "cas-")), "events.sqlite3");
  const a = SqliteDatabase.open(file); const b = SqliteDatabase.open(file);
  try {
    const host = new SqliteProjectionStore(a); const cli = new SqliteProjectionStore(b); const n = ProjectionName.of("p");
    const at = (p: number) => ProjectionCursor.of(1, GlobalPosition.of(p));
    assert.equal(host.commit(n, at(0), at(3), new Map([["count", 3]])), true);
    const seen = host.snapshot(n).cursor!;
    cli.reset(n, 1);
    assert.equal(host.commit(n, seen, at(4), new Map([["count", 4]])), false);
    assert.deepEqual([cli.cursor(n)!.position.value, cli.load(n).size], [0, 0]);
  } finally { a.close(); b.close(); }
});

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
