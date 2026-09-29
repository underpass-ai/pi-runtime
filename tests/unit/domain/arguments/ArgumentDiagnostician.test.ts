import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ArgumentDiagnostician } from "../../../../src/domain/arguments/ArgumentDiagnostician.ts";
import { JsonSchema } from "../../../../src/domain/mcp/JsonSchema.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/schemas/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const lines = (schema: Record<string, unknown>, args: unknown) => ArgumentDiagnostician.for(JsonSchema.of(schema)).diagnose(args).problems.map(String);
const render = (tool: string, schema: Record<string, unknown>, args: unknown) => ArgumentDiagnostician.for(JsonSchema.of(schema)).diagnose(args).render(ToolName.of(tool));

// Una ceremonia válida con una etapa grupo que repite hasta que el revisor aprueba.
const groupCeremony = (repeat: Record<string, unknown>) => ({
  name: "pr_review", version: "1.0", objective: "x", outputs: ["verdict"], participants: [{ role_id: "reviewer_a" }],
  stages: [{ id: "review_round", group: { steps: [{ id: "a", owner_role_id: "reviewer_a", instructions: "r" }], repeat } }],
});

test("made_design_ceremony: argumentos válidos no dan diagnóstico", () => {
  const d = ArgumentDiagnostician.for(JsonSchema.of(fixture("made_design_ceremony")))
    .diagnose(groupCeremony({ max_iterations: 4, until: { step: "a", output_field: "verdict", equals: "approve" } }));
  assert.equal(d.clean(), true);
});

test("made_design_ceremony: el repeat de grupo escrito plano da una sola línea con la forma esperada", () => {
  const message = render("made_design_ceremony", fixture("made_design_ceremony"),
    groupCeremony({ max_iterations: 4, step: "a", output_field: "verdict", equals: "approve" }));
  assert.equal(message, [
    "made_design_ceremony: the arguments do not match its input schema. Fix these and call it again:",
    "  - stages[0].group.repeat: unknown fields \"step\", \"output_field\", \"equals\"; allowed: max_iterations, until; missing required field \"until\""
      + " — Optional bounded repeat-until policy for the whole group state. — expected {max_iterations, until: {equals, output_field, step}}",
  ].join("\n"));
  assert.doesNotMatch(message, /schema is false|owner_role_id/, "nada de la rama «etapa simple» del oneOf");
});

test("made_design_ceremony: la reproducción de F1 sólo informa de la rama grupo", () => {
  const got = lines(fixture("made_design_ceremony"), {
    name: "pr_review_two_reviewers", version: "1.0", objective: "x", pattern: "single_role_action", participants: [{ role_id: "reviewer_a" }],
    stages: [{ group: { id: "review_round", steps: [{ id: "a", owner_role_id: "reviewer_a", instructions: "r" }],
      repeat: { max_iterations: 4, step: "a", output_field: "verdict", equals: "approve" } } }],
  });
  assert.deepEqual(got, [
    "arguments: missing required field \"outputs\" (Named output objects the completed ceremony promises.)",
    "pattern: \"single_role_action\" is not one of: \"roundtable_fixed_order\"",
    "stages[0]: missing required field \"id\" (State identity generated for this group.)",
    "stages[0].group: unknown field \"id\"; allowed: execution, join, repeat, steps",
    "stages[0].group.repeat: unknown fields \"step\", \"output_field\", \"equals\"; allowed: max_iterations, until",
    "stages[0].group.repeat: missing required field \"until\"",
    "arguments: matches none of the 2 accepted shapes; either field \"pattern\" is not allowed here; or stages: must be empty",
  ]);
});

test("made_design_ceremony: una etapa simple con kind de guarda equivocado se lee por su const", () => {
  const args = { name: "n", version: "1", objective: "o", outputs: ["v"], participants: [{ role_id: "r" }],
    stages: [{ id: "s", owner_role_id: "r", instructions: "i", exit_guards: [{ kind: "step_repeat_exhausted", step: "s", output_field: "v" }] }] };
  assert.deepEqual(lines(fixture("made_design_ceremony"), args), ["stages[0].exit_guards[0]: unknown field \"output_field\"; allowed: kind, step"]);
});

test("kmp_write_memory: válidos pasan; errores con ruta y sin la cascada de then/else", () => {
  const schema = fixture("kmp_write_memory");
  const ok = { about: "project:x", context_id: "c1", labels: { topic: ["a"] }, memories: [{ id: "m1", kind: "decision", summary: "s", evidence: "e" }] };
  assert.deepEqual(lines(schema, ok), []);
  assert.deepEqual(lines(schema, { ...ok, context_id: undefined }), ["arguments: missing required field \"context_id\""]);
  const bad = { ...ok, labels: { topic: "a" }, memories: [{ id: "m1", kind: "note", text: "s", evidence: "e", connect_to: [{ ref: "m0", rel: "chosen_because" }] }] };
  assert.deepEqual(lines(schema, bad), [
    "labels.topic: expected array, got string",
    "memories[0]: unknown field \"text\"; allowed: connect_to, evidence, id, kind, labels, observed_at, occurred_at, rank, ref, search_expansions, summary, summary_en, valid_from, valid_until",
    "memories[0]: missing required field \"summary\" (Literal memory text, in the language of the work. Ask cites this text byte for byte.)",
    "memories[0].kind: \"note\" is not one of: \"turn\", \"observation\", \"decision\", \"feedback\", \"semantic_delta\", \"constraint\", \"preference\", \"derived_value\", \"error_path\", \"success_path\"",
    "memories[0].connect_to[0]: missing required field \"class\"",
  ]);
});

test("tolera lo que Pi coacciona o quita antes de validar", () => {
  const schema = { type: "object", additionalProperties: false, required: ["n", "b", "s"], properties: {
    n: { type: "integer", minimum: 1 }, b: { type: "boolean" }, s: { type: "string", enum: ["1", "2"] }, opt: { type: "object", properties: {} },
    k: { const: "x" }, e: { enum: ["a"] }, f: false } };
  assert.deepEqual(lines(schema, { n: "3", b: "true", s: 1, opt: null, k: null, e: null, f: null }), []);
  assert.deepEqual(lines(schema, { n: null, b: 1, s: "2" }), []);
});

test("tipos, límites, enum, const y dependencias", () => {
  const schema = { type: "object", properties: {
    s: { type: "string", minLength: 1, maxLength: 3 }, t: { type: "string", minLength: 2 }, n: { type: "number", minimum: 0, maximum: 10, exclusiveMinimum: 0, exclusiveMaximum: 10 },
    a: { type: "array", minItems: 1, maxItems: 1, items: { type: "integer" } }, z: { type: "array", maxItems: 0 }, c: { const: 1 }, x: false,
    m: { type: "object", minProperties: 1, maxProperties: 1 }, "odd key": { type: "string" } },
    dependentRequired: { s: ["t"] } };
  assert.deepEqual(lines(schema, { s: "", t: "a", n: 10, a: [], z: [1], c: 2, x: 1, m: {}, "odd key": [] }), [
    "s: must not be empty", "t: must have at least 2 characters", "n: must be < 10, got 10",
    "a: must have at least 1 item", "z: must be empty", "c: must be 1, got 2", "x: is not allowed here",
    "m: must have at least 1 field", "[\"odd key\"]: expected string, got array",
  ]);
  assert.deepEqual(lines(schema, { s: "abcd", n: -1, a: [1, "x"], m: { a: 1, b: 2 } }), [
    "arguments: field \"s\" also needs \"t\"", "s: must have at most 3 characters", "n: must be >= 0, got -1", "n: must be > 0, got -1",
    "a: must have at most 1 item", "a[1]: expected integer, got string", "m: must have at most 1 field",
  ]);
  assert.deepEqual(lines({ type: "array", items: { type: "string" } }, [[1]]), ["arguments[0]: expected string, got array"]);
  assert.deepEqual(lines({ type: "object", maxItems: 2, properties: { t: { type: "string", maxLength: 1 } } }, { t: "ab" }), ["t: must have at most 1 character"]);
});

test("additionalProperties: cerrado sin propiedades, o con esquema para las extra", () => {
  assert.deepEqual(lines({ type: "object", additionalProperties: false }, { a: 1 }), ["arguments: unknown field \"a\"; no fields are allowed"]);
  assert.deepEqual(lines({ type: "object", additionalProperties: { type: "integer" } }, { a: "x", b: 2 }), ["a: expected integer, got string"]);
});

test("oneOf/anyOf: tipos que no encajan en ninguna rama, empates y ramas elegidas por su const", () => {
  assert.deepEqual(lines({ anyOf: [{ type: "string" }, { type: "integer" }] }, [1]), ["arguments: expected string or integer, got array"]);
  assert.deepEqual(lines({ oneOf: [{ required: ["a"] }, { required: ["b"] }] }, {}), [
    "arguments: matches none of the 2 accepted shapes; either missing required field \"a\"; or missing required field \"b\""]);
  const byKind = { type: "object", oneOf: [
    { type: "object", additionalProperties: false, required: ["kind", "a"], properties: { kind: { const: "x" }, a: { type: "string" } } },
    { type: "object", additionalProperties: false, required: ["kind", "b"], properties: { kind: { enum: ["y"] }, b: { type: "string" } } }] };
  assert.deepEqual(lines(byKind, { kind: "y", a: "1" }), ["arguments: unknown field \"a\"; allowed: kind, b", "arguments: missing required field \"b\""]);
  assert.deepEqual(lines(byKind, { kind: "y", b: "1" }), []);
  assert.deepEqual(lines({ oneOf: [{ type: "string" }, { type: "object", properties: { q: { type: "integer" } } }] }, { q: "x" }), ["q: expected integer, got string"]);
});

test("not e if/then/else sólo se evalúan cuando el esquema se entiende entero", () => {
  const schema = { type: "object", not: { required: ["a"] }, if: { properties: { k: { const: "q" } }, required: ["k"] }, then: { required: ["n"] }, else: { not: { required: ["n"] } } };
  assert.deepEqual(lines(schema, { a: 1 }), ["arguments: field \"a\" is not allowed here"]);
  assert.deepEqual(lines(schema, { k: "q" }), ["arguments: missing required field \"n\""]);
  assert.deepEqual(lines(schema, { n: 1 }), ["arguments: field \"n\" is not allowed here"]);
  assert.deepEqual(lines({ not: { required: ["a", "b"] } }, { a: 1, b: 2 }), ["arguments: fields \"a\", \"b\" must not all be present"]);
  assert.deepEqual(lines({ not: { properties: { a: { const: 1 } } } }, { a: 1 }), ["arguments: has a shape that is not allowed here"]);
  // pattern y format no se evalúan: su not/if se ignora en vez de invertir una comprobación que no se hizo.
  assert.deepEqual(lines({ not: { pattern: "^a" } }, "abc"), []);
  assert.deepEqual(lines({ if: { properties: { a: { type: "string" } } }, then: { required: ["z"] } }, { a: "x" }), []);
});

test("un esquema raro o incomprensible nunca produce diagnóstico", () => {
  for (const schema of [{ $ref: "#/defs/x" }, { type: "weird" }, { properties: "nope", required: "x", oneOf: "y", items: 3, dependentRequired: { a: "b" } }, { type: ["string", 7] }]) {
    assert.deepEqual(lines(schema as Record<string, unknown>, { a: 1 }), [], JSON.stringify(schema));
  }
  assert.deepEqual(lines({ const: 1 }, Number.NaN), ["arguments: must be 1, got null"]);
});
