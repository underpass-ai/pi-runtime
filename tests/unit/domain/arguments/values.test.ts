import { test } from "node:test";
import assert from "node:assert/strict";
import { ArgumentDiagnosis } from "../../../../src/domain/arguments/ArgumentDiagnosis.ts";
import { ArgumentPath } from "../../../../src/domain/arguments/ArgumentPath.ts";
import { ArgumentProblem } from "../../../../src/domain/arguments/ArgumentProblem.ts";
import { JsonType } from "../../../../src/domain/arguments/JsonType.ts";
import { OptionalNullPruning } from "../../../../src/domain/arguments/OptionalNullPruning.ts";
import { SchemaNode } from "../../../../src/domain/arguments/SchemaNode.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("JsonType: rechaza nombres desconocidos; admits tolera la coacción de Pi y holds no", () => {
  assert.throws(() => JsonType.of("date"), DomainError);
  assert.throws(() => JsonType.of(3 as unknown as string), DomainError);
  const admits: [string, unknown, boolean][] = [
    ["string", 3, true], ["string", null, true], ["string", [], false],
    ["number", "2.5", true], ["number", " ", false], ["number", "x", false], ["number", true, true],
    ["integer", "3", true], ["integer", "3.5", false], ["integer", 2.5, false], ["integer", null, true],
    ["boolean", "false", true], ["boolean", 1, true], ["boolean", 2, false], ["boolean", null, true],
    ["null", "", true], ["null", 0, true], ["null", false, true], ["null", "x", false],
    ["object", {}, true], ["object", [], false], ["object", null, false], ["array", [], true], ["array", {}, false],
  ];
  for (const [t, v, ok] of admits) assert.equal(JsonType.of(t).admits(v), ok, `${t} admits ${JSON.stringify(v)}`);
  assert.equal(JsonType.of("integer").holds("3"), false);
  assert.deepEqual([null, [], 1, 1.5, "s", true, {}].map(JsonType.nameOf), ["null", "array", "integer", "number", "string", "boolean", "object"]);
});

test("ArgumentPath: la raíz se llama arguments; claves raras van entre corchetes", () => {
  assert.equal(String(ArgumentPath.ROOT), "arguments");
  assert.equal(String(ArgumentPath.ROOT.field("stages").index(0).field("group")), "stages[0].group");
  assert.equal(String(ArgumentPath.ROOT.field("a b")), "[\"a b\"]");
  assert.equal(String(ArgumentPath.ROOT.field("x").field("a-b")), "x[\"a-b\"]");
  assert.equal(String(ArgumentPath.ROOT.index(2)), "arguments[2]");
  assert.equal(ArgumentPath.ROOT.field("a").equals(ArgumentPath.ROOT.field("a")), true);
});

test("ArgumentDiagnosis: agrupa por ruta, no repite pistas y corta a doce líneas", () => {
  const p = ArgumentPath.ROOT.field("a");
  const one = ArgumentDiagnosis.of([ArgumentProblem.at(p, "x", "hint"), ArgumentProblem.at(p, "x", "hint"), ArgumentProblem.at(p, "y")]);
  assert.equal(one.render(ToolName.of("kmp_ask")), "kmp_ask: the arguments do not match its input schema. Fix these and call it again:\n  - a: x; y — hint");
  const many = ArgumentDiagnosis.of(Array.from({ length: 14 }, (_, i) => ArgumentProblem.at(ArgumentPath.ROOT.field(`f${i}`), "bad")));
  const lines = many.render(ToolName.of("kmp_ask")).split("\n");
  assert.equal(lines.length, 14);
  assert.equal(lines.at(-1), "  - …and 2 more");
  assert.equal(ArgumentDiagnosis.CLEAN.clean(), true);
});

test("SchemaNode: descripción recortada, forma anidada y exactitud", () => {
  const node = SchemaNode.of({ description: `  ${"d".repeat(300)}  `, properties: { a: { properties: { b: {} } }, c: {} } });
  assert.equal(node.description()!.length, 240);
  assert.equal(node.shape(), "{a: {b}, c}");
  assert.equal(SchemaNode.of({}).shape(), "{}");
  assert.equal(SchemaNode.of("junk").forbidsEverything(), false);
  assert.equal(SchemaNode.of({ description: " " }).description(), null);
  assert.equal(SchemaNode.of({ "x-made": 1, title: "t", required: ["a"] }).exact(), true);
  assert.equal(SchemaNode.of({ type: "string" }).exact(), false);
  assert.equal(SchemaNode.of({ properties: { a: { format: "date-time" } } }).exact(), false);
});

test("OptionalNullPruning: quita opcionales a null que el esquema no admite, en objetos y listas", () => {
  const node = SchemaNode.of({ type: "array", items: { properties: { a: { type: "string" }, b: { type: ["string", "null"] }, c: {}, d: { type: "string" }, e: false }, required: ["d"] } });
  assert.deepEqual(OptionalNullPruning.apply(node, [{ a: null, b: null, c: null, d: null, e: null, z: null }]), [{ b: null, c: null, d: null, z: null }]);
  assert.deepEqual(OptionalNullPruning.apply(SchemaNode.of({}), [null]), [null]);
});
