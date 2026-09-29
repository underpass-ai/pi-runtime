import { test } from "node:test";
import assert from "node:assert/strict";
import { SeededRandom } from "../../../../src/domain/learning/SeededRandom.ts";
import { SelectionSize } from "../../../../src/domain/learning/SelectionSize.ts";
import { SlidingBeta } from "../../../../src/domain/learning/SlidingBeta.ts";
import { ThompsonSelector } from "../../../../src/domain/learning/ThompsonSelector.ts";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const seed = (n: number) => EventId.of(`session:s1:tools.selected:select.h.${n}.0`);
const tools = (n: number) => Array.from({ length: n }, (_, i) => ToolName.of(`kmp_t${String(i).padStart(2, "0")}`));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("el PRNG sembrado con el event_id es determinista y uniforme", () => {
  const a = SeededRandom.from(seed(1)); const b = SeededRandom.from(seed(1)); const c = SeededRandom.from(seed(2));
  const xs = Array.from({ length: 5000 }, () => a.next());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b.next()));
  assert.notEqual(xs[0], c.next());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.ok(Math.abs(mean(xs) - 0.5) < 0.02);
});

test("gamma y beta tienen la media esperada, también con forma fraccionaria", () => {
  const r = SeededRandom.from(seed(3));
  assert.ok(Math.abs(mean(Array.from({ length: 4000 }, () => r.gamma(3))) - 3) < 0.15);
  assert.ok(Math.abs(mean(Array.from({ length: 4000 }, () => r.gamma(0.4))) - 0.4) < 0.05);
  assert.ok(Math.abs(mean(Array.from({ length: 4000 }, () => r.beta(8, 2))) - 0.8) < 0.02);
  assert.ok(Math.abs(mean(Array.from({ length: 4000 }, () => r.beta(1.2, 1))) - 1.2 / 2.2) < 0.02);
  assert.ok(Array.from({ length: 1000 }, () => r.beta(0.2, 0.2)).every((x) => x >= 0 && x <= 1));
});

test("ventana deslizante: 200 observaciones, recompensa ponderada y prior de tool_stats sólo en α, hasta 5", () => {
  let b = SlidingBeta.EMPTY;
  assert.deepEqual([b.alpha(), b.beta(), b.mean(), b.n], [1, 1, 0.5, 0]);
  b = b.observe(1, 1).observe(0, 1).observe(0, 0.2);
  assert.deepEqual([b.alpha(), b.beta(), b.n], [2, 2.2, 3]);
  assert.equal(b.alpha(3), 5);
  assert.equal(b.alpha(40), 7, "min(éxitos, 5)");
  assert.equal(b.alpha(-2), 2);
  assert.equal(b.alpha(Number.NaN), 2);
  assert.ok(Math.abs(b.mean(5) - 7 / 9.2) < 1e-12);
  for (let i = 0; i < 250; i++) b = b.observe(1, 1);
  assert.equal(b.n, 200);
  assert.deepEqual([b.alpha(), b.beta()], [201, 1], "las 3 primeras salieron de la ventana");
  assert.deepEqual(SlidingBeta.fromJson(b.toJson()).toJson(), b.toJson());
  assert.equal(SlidingBeta.fromJson([]).n, 0);
  for (const bad of [null, {}, [[1]], [[2, 1]], [[1, 0]], [[1, 1.5]], [[0, "1"]]]) assert.throws(() => SlidingBeta.fromJson(bad), DomainError, JSON.stringify(bad));
});

test("Thompson con semilla fija: reproducible, k mejores, empates por nombre y todas si no hay más de k", () => {
  const candidates = tools(20);
  const good = new Set(["kmp_t03", "kmp_t07", "kmp_t11", "kmp_t15"]);
  const arms = new Map(candidates.map((t) => [t.value, good.has(t.value) ? SlidingBeta.EMPTY.observe(1, 1).observe(1, 1).observe(1, 1).observe(1, 1).observe(1, 1).observe(1, 1).observe(1, 1).observe(1, 1)
    : [0, 0, 0, 0, 0, 0, 0, 0].reduce((b) => b.observe(0, 1), SlidingBeta.EMPTY)]));
  const posterior = (t: ToolName) => ({ alpha: arms.get(t.value)!.alpha(), beta: arms.get(t.value)!.beta() });
  const k = SelectionSize.of(4);
  const first = ThompsonSelector.select(candidates, posterior, k, SeededRandom.from(seed(9))).map(String);
  assert.deepEqual(ThompsonSelector.select([...candidates].reverse(), posterior, k, SeededRandom.from(seed(9))).map(String), first, "no depende del orden de entrada");
  assert.equal(first.length, 4);
  assert.deepEqual([...first].sort(), [...good].sort());
  const flat = () => ({ alpha: 1, beta: 1 });
  const constant = { beta: () => 0.5 } as unknown as SeededRandom;
  assert.deepEqual(ThompsonSelector.select(candidates, flat, k, constant).map(String), ["kmp_t00", "kmp_t01", "kmp_t02", "kmp_t03"], "empates por nombre");
  assert.deepEqual(ThompsonSelector.select(tools(4).reverse(), flat, k, SeededRandom.from(seed(1))).map(String), ["kmp_t00", "kmp_t01", "kmp_t02", "kmp_t03"]);
});
