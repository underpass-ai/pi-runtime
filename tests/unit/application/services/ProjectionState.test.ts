import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectionState } from "../../../../src/application/services/ProjectionState.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("set valida que el valor sea JSON canónico: los que no lo son fallan con DomainError", () => {
  const s = new ProjectionState(new Map());
  for (const bad of [1n, NaN, Infinity, () => 1, undefined, { nested: -Infinity }]) assert.throws(() => s.set("k", bad), DomainError);
  assert.equal(s.get("k"), undefined);
});

test("set guarda una copia JSON del valor: mutar el original no cambia el estado", () => {
  const s = new ProjectionState(new Map([["a", 1]])); const v = { list: [1, 2], nested: { x: "y" }, gone: undefined };
  s.set("v", v); v.list.push(3);
  assert.deepEqual(s.get("v"), { list: [1, 2], nested: { x: "y" } });
  s.accept();
  assert.deepEqual([...s.changes().keys(), ...s.keys()].sort(), ["a", "v", "v"]);
});

test("delete quita la clave: get devuelve undefined, keys no la lista y el cambio viaja como undefined (borrado)", () => {
  const s = new ProjectionState(new Map<string, unknown>([["a", 1], ["b", 2]]));
  s.delete("a"); s.set("c", 3); s.delete("c");
  assert.equal(s.get("a"), undefined);
  assert.deepEqual(s.keys().sort(), ["b"]);
  s.accept();
  assert.deepEqual([...s.changes()].sort(), [["a", undefined], ["c", undefined]]);
  s.set("a", 4); s.accept();
  assert.deepEqual([s.get("a"), s.changes().get("a")], [4, 4], "volver a escribir después de borrar");
  s.delete("b"); s.discard();
  assert.equal(s.get("b"), 2, "discard deshace el borrado pendiente");
});
