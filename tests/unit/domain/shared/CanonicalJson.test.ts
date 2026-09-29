import { test } from "node:test";
import assert from "node:assert/strict";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("ordena claves en profundidad, conserva el orden de arrays y omite undefined", () => {
  const a = CanonicalJson.of({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } });
  assert.equal(a.text, '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.ok(a.equals(CanonicalJson.parse('{ "b":1, "a":{"d":[3,{"z":1,"y":2}]} }')));
  assert.deepEqual(a.toValue(), { a: { d: [3, { y: 2, z: 1 }] }, b: 1 });
});

test("rechaza números no finitos, funciones y JSON inválido", () => {
  assert.throws(() => CanonicalJson.of({ x: Number.NaN }), DomainError);
  assert.throws(() => CanonicalJson.of({ f: () => 1 }), DomainError);
  assert.throws(() => CanonicalJson.parse("{nope"), DomainError);
});

test("rechaza objetos que no son planos (Date, Map, Set, instancias de clase) y acepta los de prototipo nulo", () => {
  class Point { x = 1; }
  for (const bad of [new Date(0), new Map([["a", 1]]), new Set([1]), new Point(), { nested: [new Date(0)] }, new Uint8Array(2), /re/]) {
    assert.throws(() => CanonicalJson.of(bad), DomainError);
  }
  const bare = Object.create(null) as Record<string, unknown>; bare.b = 2; bare.a = 1;
  assert.equal(CanonicalJson.of(bare).text, '{"a":1,"b":2}');
});
