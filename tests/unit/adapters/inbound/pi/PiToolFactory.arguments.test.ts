import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import { McpToolMapper } from "../../../../../src/application/mappers/McpToolMapper.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";

// F1: Pi 0.87.1 llama a prepareArguments antes de validar contra `parameters`, y el mensaje de lo
// que lance le llega al modelo como resultado de error de la tool.
const schema = JSON.parse(readFileSync(new URL("../../../../fixtures/schemas/made_design_ceremony.json", import.meta.url), "utf8"));
const gateway = async () => { throw new Error("no se llama"); };
// Pi rechaza siempre: aquí se prueba el diagnóstico; la condición de Pi, en el último test.
const tool = new PiToolFactory((j) => j, undefined, () => false).create(ServerName.MADE, new McpToolMapper().toDomain({ name: "made_design_ceremony", inputSchema: schema }), gateway);
const ceremony = (repeat: Record<string, unknown>) => ({
  name: "pr_review", version: "1.0", objective: "x", outputs: ["verdict"], participants: [{ role_id: "reviewer_a" }],
  stages: [{ id: "review_round", group: { steps: [{ id: "a", owner_role_id: "reviewer_a", instructions: "r" }], repeat } }],
});

test("prepareArguments deja pasar sin tocar (el mismo objeto) lo que casa con el esquema", () => {
  const args = ceremony({ max_iterations: 4, until: { step: "a", output_field: "verdict", equals: "approve" } });
  assert.equal(tool.prepareArguments(args), args);
});

test("sin validador de Pi inyectado, prepareArguments nunca lanza", () => {
  const plain = new PiToolFactory((j) => j).create(ServerName.MADE, new McpToolMapper().toDomain({ name: "made_design_ceremony", inputSchema: schema }), gateway);
  const flat = ceremony({ max_iterations: 4, step: "a", output_field: "verdict", equals: "approve" });
  assert.equal(plain.prepareArguments(flat), flat);
});

test("prepareArguments lanza el diagnóstico enfocado cuando no casa y Pi rechaza", () => {
  assert.throws(() => tool.prepareArguments(ceremony({ max_iterations: 4, step: "a", output_field: "verdict", equals: "approve" })), (e: Error) =>
    e.message.startsWith("made_design_ceremony: the arguments do not match its input schema.")
    && e.message.includes("stages[0].group.repeat: unknown fields \"step\", \"output_field\", \"equals\"; allowed: max_iterations, until")
    && !e.message.includes("schema is false"));
});

test("si el diagnóstico falla por dentro, los argumentos pasan tal cual y decide Pi", () => {
  const hostile = { get name() { throw new Error("getter"); } };
  Object.defineProperty(hostile, "name", { enumerable: true, get() { throw new Error("getter"); } });
  assert.equal(tool.prepareArguments(hostile), hostile);
});

test("con el validador de Pi inyectado: sólo lanza si Pi también rechaza", () => {
  const flat = ceremony({ max_iterations: 4, step: "a", output_field: "verdict", equals: "approve" });
  const seen: { name: string; parameters: unknown }[] = [];
  const descriptor = new McpToolMapper().toDomain({ name: "made_design_ceremony", inputSchema: schema });
  const accepting = new PiToolFactory((j) => ({ compiled: j }), undefined, (t) => { seen.push(t); return true; }).create(ServerName.MADE, descriptor, gateway);
  assert.equal(accepting.prepareArguments(flat), flat, "Pi acepta: pasa sin tocar aunque F1 vea problemas");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "made_design_ceremony");
  assert.equal(seen[0].parameters, accepting.parameters, "se valida contra los mismos parameters que ve Pi");
  const rejecting = new PiToolFactory((j) => j, undefined, () => false).create(ServerName.MADE, descriptor, gateway);
  assert.throws(() => rejecting.prepareArguments(flat), /stages\[0\]\.group\.repeat: unknown fields/);
  let asked = 0;
  const unasked = new PiToolFactory((j) => j, undefined, () => { asked++; return false; }).create(ServerName.MADE, descriptor, gateway);
  const ok = ceremony({ max_iterations: 4, until: { step: "a", output_field: "verdict", equals: "approve" } });
  assert.equal(unasked.prepareArguments(ok), ok);
  assert.equal(asked, 0, "si F1 no ve nada, no se consulta a Pi");
  const throwing = new PiToolFactory((j) => j, undefined, () => { throw new Error("pi"); }).create(ServerName.MADE, descriptor, gateway);
  assert.equal(throwing.prepareArguments(flat), flat, "un validador que falla no bloquea la llamada");
});
