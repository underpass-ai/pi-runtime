import { test } from "node:test";
import assert from "node:assert/strict";
import type { BanditArmDto } from "../../../../src/application/dto/BanditArmDto.ts";
import { ToolBanditProjection } from "../../../../src/application/projections/ToolBanditProjection.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { fact } from "../../../support/recordFixtures.ts";
import { DESIGN, LearningLog, PROJECT, selection, turn, used } from "../../../support/learningFixtures.ts";

const S2 = StreamId.session(SessionId.of("s2"));
const log = () => new LearningLog([new ToolBanditProjection()]).add(fact("session.opened", "o"));
const obs = (l: LearningLog, tool: string, context = DESIGN) => (l.store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.armKey(context, tool)) as BanditArmDto | undefined)?.obs ?? null;
const open = (l: LearningLog) => (l.store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.OPEN_KEY) ?? {}) as Record<string, unknown>;

test("active sin control: éxito 1, fallo 0 a peso 1 y 0 suave de 0,2 para la seleccionada no usada", () => {
  const l = log().addAll([selection("d1"), turn("t1"), used("c1", "kmp_time", "succeeded"), used("c2", "kmp_time", "failed"), used("c3", "kmp_trace", "succeeded"), used("c4", "bash", "failed"),
    fact("session.closed", "x")]);
  assert.deepEqual(obs(l, "kmp_time"), [[1, 1]], "sólo la primera invocación cuenta");
  assert.deepEqual(obs(l, "kmp_guide"), [[0, 0.2]]);
  assert.equal(obs(l, "kmp_trace"), null, "una candidata no expuesta no se observa");
  assert.equal(obs(l, "bash"), null);
  assert.deepEqual(open(l), {});
  const arm = l.store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.armKey(DESIGN, "kmp_guide")) as BanditArmDto;
  assert.deepEqual([arm.phase, arm.project, arm.tool], ["design", PROJECT, "kmp_guide"]);
  assert.deepEqual(l.store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.candidatesKey(DESIGN)), ["kmp_guide", "kmp_time", "kmp_trace", "made_get_help"]);
});

test("una primera invocación refused o aborted no cuenta, ni las siguientes de esa tool", () => {
  const l = log().addAll([selection("d1"), turn("t1"), used("c1", "kmp_time", "refused"), used("c2", "kmp_time", "succeeded"), used("c3", "kmp_guide", "aborted"), fact("session.closed", "x")]);
  assert.equal(obs(l, "kmp_time"), null);
  assert.equal(obs(l, "kmp_guide"), null, "usada (aunque abortada): no es un 0 suave");
});

test("shadow y control: las usadas actualizan con peso 1 y no hay 0 suave", () => {
  for (const overrides of [{ mode: "shadow" }, { mode: "active", control: true }, { mode: "fallback" }]) {
    const l = log().addAll([selection("d1", overrides), turn("t1"), used("c1", "kmp_trace", "succeeded"), used("c2", "made_get_help", "failed"), fact("session.closed", "x")]);
    assert.deepEqual([obs(l, "kmp_trace"), obs(l, "made_get_help"), obs(l, "kmp_time"), obs(l, "kmp_guide")], [[[1, 1]], [[0, 1]], null, null], JSON.stringify(overrides));
  }
});

test("la ventana acaba donde empieza la siguiente selección y se cierra con el primer hecho de Pi posterior; sin turnos no hay 0 suave", () => {
  const l = log().addAll([selection("d1", {}, undefined, 1_000), selection("d2", {}, undefined, 2_000), turn("t1", undefined, 2_500)]);
  assert.equal(obs(l, "kmp_time"), null, "d1 se cerró sin turnos");
  l.addAll([selection("d3", { selected: ["made_get_help"] }, undefined, 3_000)]);
  assert.equal(obs(l, "kmp_time"), null, "d2 sigue abierta: aún pueden llegar hechos suyos");
  l.add(turn("t2", undefined, 3_100));
  assert.deepEqual([obs(l, "kmp_time"), obs(l, "kmp_guide")], [[[0, 0.2]], [[0, 0.2]]], "d2 tuvo un turno");
  l.add(fact("session.opened", "o2", { reason: "resume" }, undefined, 4_000));
  assert.deepEqual(obs(l, "made_get_help"), [[0, 0.2]], "la reapertura cierra d3");
  assert.deepEqual(open(l), {});
});

test("un hecho de Pi que llega tras la decisión siguiente se atribuye por su occurredAt a la suya", () => {
  const l = log().addAll([selection("d1", {}, undefined, 1_000), selection("d2", { selected: ["kmp_trace"] }, undefined, 2_000),
    turn("t1", undefined, 1_500), used("c1", "kmp_time", "succeeded", undefined, 1_600), used("c2", "kmp_trace", "succeeded", undefined, 1_700)]);
  assert.deepEqual(obs(l, "kmp_time"), [[1, 1]], "c1 es de d1");
  assert.equal(obs(l, "kmp_trace"), null, "kmp_trace no estaba expuesta en d1");
  l.addAll([turn("t2", undefined, 2_100), used("c3", "kmp_trace", "failed", undefined, 2_200), used("c0", "kmp_guide", "succeeded", undefined, 500)]);
  assert.deepEqual(obs(l, "kmp_guide"), [[0, 0.2]], "d1 se cerró con t2: kmp_guide no se usó en su ventana");
  assert.deepEqual(obs(l, "kmp_trace"), [[0, 1]]);
  assert.equal(Object.keys(open(l)).length, 1);
});

test("una sesión abandonada (24 h sin hechos) cierra su ventana con el siguiente hecho de cualquier stream", () => {
  const l = log().addAll([selection("d1"), turn("t1")], 1_000);
  l.add(fact("session.opened", "o", {}, S2), 1_000 + 24 * 3_600_000 - 1);
  assert.equal(obs(l, "kmp_time"), null);
  l.add(fact("turn.completed", "t", {}, S2), 1_000 + 24 * 3_600_000);
  assert.deepEqual(obs(l, "kmp_time"), [[0, 0.2]]);
  assert.deepEqual(Object.keys(open(l)), []);
});

test("el modo vigente y k salen de learning.mode_changed; payloads raros se toleran", () => {
  const l = log();
  const mode = () => l.store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.MODE_KEY);
  assert.equal(mode(), undefined);
  assert.deepEqual(ToolBanditProjection.DEFAULT_MODE, { mode: "shadow", k: 12 });
  l.add(fact("learning.mode_changed", "m1", { from: "shadow", to: "active", k: 8 }, StreamId.HOST));
  assert.deepEqual(mode(), { mode: "active", k: 8 });
  l.add(fact("learning.mode_changed", "m2", { from: "active", to: "off", k: 3 }, StreamId.HOST));
  assert.deepEqual(mode(), { mode: "off", k: 8 }, "un k inválido conserva el anterior");
  l.add(fact("learning.mode_changed", "m3", { to: "eager" }, StreamId.HOST));
  assert.deepEqual(mode(), { mode: "off", k: 8 });
  l.addAll([fact("tools.selected", "raro", { context: "x", mode: "active" }), fact("tools.selected", "raro2", { mode: "turbo" }), turn("t"), used("c", "kmp_time", "succeeded")]);
  assert.deepEqual(open(l), {});
  assert.equal(obs(l, "kmp_time"), null);
  l.addAll([selection("d1", { selected: "kmp_time", candidates: ["kmp_time", 3] }), used("c2", "kmp_time", "succeeded")]);
  assert.deepEqual(obs(l, "kmp_time"), null, "selected no es una lista: nada seguido");
});

test("proyección igual en modo incremental y reconstruida", () => {
  const facts = [selection("d1"), turn("t1"), used("c1", "kmp_time", "succeeded"), selection("d2", { mode: "shadow" }), used("c2", "kmp_trace", "failed"),
    fact("learning.mode_changed", "m", { from: "shadow", to: "active", k: 6 }, StreamId.HOST), selection("d3", { control: true }), fact("session.closed", "x")];
  const incremental = log().addAll(facts);
  const rebuilt = new LearningLog([new ToolBanditProjection()]);
  for (const f of [fact("session.opened", "o"), ...facts]) rebuilt.write(f);
  rebuilt.runner.rebuild(ToolBanditProjection.NAME);
  assert.deepEqual(rebuilt.store.load(ToolBanditProjection.NAME), incremental.store.load(ToolBanditProjection.NAME));
  assert.ok(incremental.store.load(ToolBanditProjection.NAME).size >= 4);
});
