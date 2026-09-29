import { test } from "node:test";
import assert from "node:assert/strict";
import type { LearningEvalDto } from "../../../../src/application/dto/LearningEvalDto.ts";
import { LearningEvalProjection } from "../../../../src/application/projections/LearningEvalProjection.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { fact } from "../../../support/recordFixtures.ts";
import { DESIGN, LearningLog, selection, turn, used } from "../../../support/learningFixtures.ts";

const S2 = StreamId.session(SessionId.of("s2"));
const log = () => new LearningLog([new LearningEvalProjection()]).add(fact("session.opened", "o"));
const evalOf = (l: LearningLog) => l.store.load(LearningEvalProjection.NAME).get(LearningEvalProjection.contextKey(DESIGN)) as LearningEvalDto | undefined;

test("shadow: miss de las candidatas usadas fuera de la selección y ahorro en tools y bytes", () => {
  const l = log().addAll([
    selection("d1", { mode: "shadow" }), turn("t1"), used("c1", "kmp_time", "succeeded"), used("c2", "kmp_time", "failed"), used("c3", "kmp_trace", "succeeded"),
    used("c4", "kmp_ask", "succeeded"), used("c5", "bash", "succeeded"),
    selection("d2", { mode: "shadow", schemaBytes: { full: 1000, exposed: 400 } }), used("c6", "made_get_help", "succeeded"),
  ]);
  assert.deepEqual(l.store.load(LearningEvalProjection.NAME).get(LearningEvalProjection.sessionKey("s1")), { context: DESIGN, mode: "shadow", control: false, selected: 2, candidates: 4 });
  l.addAll([fact("session.closed", "x"), used("c7", "kmp_trace", "succeeded")]);
  assert.deepEqual(evalOf(l)!.shadow, { decisions: 2, used: 3, missed: 2, fullTools: 12, exposedTools: 8, fullBytes: 2000, exposedBytes: 1000 });
});

test("active: tratado frente a control con éxito a la primera, turnos y negativas de KMP y MADE", () => {
  const l = log().addAll([
    selection("d1"), turn("t1"), used("c1", "kmp_time", "failed"), used("c2", "kmp_time", "succeeded"), used("c3", "kmp_ask", "refused"), used("c4", "bash", "refused"), turn("t2"),
    selection("d2", { control: true }), turn("t3"), used("c5", "kmp_trace", "succeeded"),
    selection("d3", { mode: "fallback" }), used("c6", "kmp_trace", "succeeded"), turn("t4"),
  ]);
  const x = evalOf(l)!;
  assert.deepEqual(x.treated, { decisions: 1, firstTryAttempted: 2, firstTrySucceeded: 0, turns: 2, invocations: 3, refused: 1 });
  assert.deepEqual(x.control, { decisions: 1, firstTryAttempted: 1, firstTrySucceeded: 1, turns: 1, invocations: 1, refused: 0 });
  assert.equal(x.shadow.decisions, 0);
  assert.deepEqual(l.store.load(LearningEvalProjection.NAME).get(LearningEvalProjection.sessionKey("s1")), { context: DESIGN, mode: "fallback", control: false, selected: 2, candidates: 4 });
});

test("ventanas: abandono a las 24 h, reapertura y payloads raros", () => {
  const l = log().addAll([selection("d1", { mode: "shadow" })], 1_000);
  l.add(fact("session.opened", "o", {}, S2), 1_000 + 24 * 3_600_000);
  l.add(used("c1", "kmp_trace", "succeeded"));
  assert.equal(evalOf(l)!.shadow.used, 0, "la ventana abandonada ya no cuenta");
  l.addAll([selection("d2", { mode: "shadow" }), fact("session.opened", "o2"), used("c2", "kmp_trace", "succeeded")]);
  assert.equal(evalOf(l)!.shadow.used, 0);
  l.addAll([fact("tools.selected", "raro", { mode: "shadow", context: null }), used("c3", "kmp_trace", "succeeded"), fact("tools.selected", "raro2", { context: { phase: "design", project: "ecf99390f4089f4f" } })]);
  assert.equal(evalOf(l)!.shadow.decisions, 2);
  assert.deepEqual(l.store.load(LearningEvalProjection.NAME).get(LearningEvalProjection.OPEN_KEY), {});
});

test("learning_eval igual en modo incremental y reconstruida", () => {
  const facts = [selection("d1", { mode: "shadow" }), used("c1", "kmp_trace", "succeeded"), selection("d2"), turn("t"), used("c2", "kmp_time", "succeeded"), selection("d3", { control: true }), fact("session.closed", "x")];
  const incremental = log().addAll(facts);
  const rebuilt = new LearningLog([new LearningEvalProjection()]);
  for (const f of [fact("session.opened", "o"), ...facts]) rebuilt.write(f);
  rebuilt.runner.rebuild(LearningEvalProjection.NAME);
  assert.deepEqual(rebuilt.store.load(LearningEvalProjection.NAME), incremental.store.load(LearningEvalProjection.NAME));
});

test("una sesión que sólo acumula decisiones sin hechos de Pi guarda como mucho 32 ventanas abiertas", () => {
  const l = log();
  for (let i = 0; i < 40; i++) l.add(selection(`d${i}`, { mode: "shadow" }, undefined, 1_000 + i));
  const open = l.store.load(LearningEvalProjection.NAME).get(LearningEvalProjection.OPEN_KEY) as Record<string, { windows: { atMs: number }[] }>;
  assert.equal(open["session:s1"].windows.length, 32);
  assert.equal(open["session:s1"].windows[0].atMs, 1_008, "se cierran las más antiguas");
});

// Estado acotado: la línea de /underpass-status de una sesión (session|<id>) vive mientras la
// sesión tenga una decisión abierta; se borra al cerrarse, reabrirse sin decisión o abandonarse.
test("session|<id> se borra al cerrar o abandonar la sesión, también al reconstruir", () => {
  const S3 = StreamId.session(SessionId.of("s3"));
  const sessions = (l: LearningLog) => [...l.store.load(LearningEvalProjection.NAME).keys()].filter((k) => k.startsWith("session|")).sort();
  const facts = [
    selection("d1", { mode: "shadow" }), fact("session.opened", "o2", {}, S2), selection("d2", { mode: "shadow" }, S2), fact("session.opened", "o3", {}, S3), selection("d3", { mode: "shadow" }, S3),
  ];
  const l = log().addAll(facts);
  assert.deepEqual(sessions(l), ["session|s1", "session|s2", "session|s3"]);
  l.add(fact("session.closed", "x"));
  assert.deepEqual(sessions(l), ["session|s2", "session|s3"], "cerrada: fuera");
  l.add(turn("t2", S3), 5_000 + 12 * 3_600_000).add(turn("t3", S3), 5_000 + 24 * 3_600_000);
  assert.deepEqual(sessions(l), ["session|s3"], "s2 sin hechos en 24 h: abandonada y fuera; s3 sigue viva");
  const rebuilt = new LearningLog([new LearningEvalProjection()]);
  for (const f of [fact("session.opened", "o"), ...facts, fact("session.closed", "x")]) rebuilt.write(f);
  rebuilt.write(turn("t2", S3), 5_000 + 12 * 3_600_000).write(turn("t3", S3), 5_000 + 24 * 3_600_000);
  rebuilt.runner.rebuild(LearningEvalProjection.NAME);
  assert.deepEqual(rebuilt.store.load(LearningEvalProjection.NAME), l.store.load(LearningEvalProjection.NAME));
});
