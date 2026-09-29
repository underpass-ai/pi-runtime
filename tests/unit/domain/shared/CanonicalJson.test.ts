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
