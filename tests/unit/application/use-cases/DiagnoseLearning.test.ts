import { test } from "node:test";
import assert from "node:assert/strict";
import { LearningEvalProjection } from "../../../../src/application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../../../../src/application/projections/ToolBanditProjection.ts";
import { DiagnoseLearning } from "../../../../src/application/use-cases/DiagnoseLearning.ts";
import { ReadLearningStatus } from "../../../../src/application/use-cases/ReadLearningStatus.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { fact } from "../../../support/recordFixtures.ts";
import { LearningLog, selection, turn, used } from "../../../support/learningFixtures.ts";

const log = () => new LearningLog([new ToolBanditProjection(), new LearningEvalProjection()]).add(fact("session.opened", "o"));
const checks = (l: LearningLog) => new DiagnoseLearning(l.events, l.store).execute().map((c) => [c.section.value, c.status.value, c.name.value, c.detail.value]);
const mode = (to: string, about: string) => fact("learning.mode_changed", about, { from: "shadow", to, k: 12 }, StreamId.HOST);
// n decisiones de un grupo, cada una con una primera invocación que acierta con probabilidad `rate`.
function decisions(l: LearningLog, control: boolean, n: number, successes: number, prefix: string): void {
  for (let i = 0; i < n; i++) l.addAll([selection(`${prefix}${i}`, { control }), turn(`${prefix}t${i}`), used(`${prefix}c${i}`, "kmp_time", i < successes ? "succeeded" : "failed")]);
}

test("sin log, off y shadow son OK; la línea de shadow lleva decisiones y miss", () => {
  const empty = new LearningLog([new ToolBanditProjection(), new LearningEvalProjection()]);
  assert.deepEqual(checks(empty), [["learning", "OK", "learning projections", "no events yet"], ["learning", "OK", "learning mode", "shadow (k=12), 0 decisions"]]);
  const l = log().addAll([selection("d1", { mode: "shadow" }), used("c1", "kmp_trace", "succeeded")]);
  assert.deepEqual(checks(l)[1], ["learning", "OK", "learning mode", "shadow (k=12), 1 decisions, miss 100.0%"]);
  l.add(mode("off", "m"));
  assert.deepEqual(checks(l)[1], ["learning", "OK", "learning mode", "off"]);
});

test("WARN si las proyecciones de L1 van por detrás o tienen cuarentena", () => {
  const l = log();
  l.write(fact("turn.completed", "t"));
  assert.match(checks(l)[0][3], /^tool_bandit at 1\/2; learning_eval at 1\/2; start pi/);
  assert.equal(checks(l)[0][1], "WARN");
  l.runner.runOnce();
  l.store.quarantine(ToolBanditProjection.NAME, GlobalPosition.of(1), "boom");
  assert.match(checks(l)[0][3], /tool_bandit has 1 quarantined events/);
  const fresh = new LearningLog([]);
  fresh.write(fact("session.opened", "o"));
  assert.match(checks(fresh)[0][3], /tool_bandit not built yet; learning_eval not built yet/);
});

test("active: WARN si el control acierta a la primera más de 5 puntos que el tratado con n ≥ 50 en cada grupo", () => {
  const l = log().add(mode("active", "m"));
  decisions(l, false, 50, 30, "a");
  decisions(l, true, 50, 34, "b");
  const [, warn] = checks(l);
  assert.deepEqual(warn.slice(0, 3), ["learning", "WARN", "learning mode"]);
  assert.equal(warn[3], "active (k=12), first-try treated 60.0% (n=50) vs control 68.0% (n=50); the control group does better: run underpass learning mode shadow");
  const close = log().add(mode("active", "m"));
  decisions(close, false, 50, 30, "a"); decisions(close, true, 50, 32, "b");
  assert.equal(checks(close)[1][1], "OK", "4 puntos no bastan");
  const few = log().add(mode("active", "m"));
  decisions(few, false, 50, 10, "a"); decisions(few, true, 49, 49, "b");
  assert.equal(checks(few)[1][1], "OK", "n < 50 en control");
  assert.match(checks(log().add(mode("active", "m")))[1][3], /^active \(k=12\), first-try treated - \(n=0\) vs control - \(n=0\)$/);
});

test("estado para /underpass-status: modo, última decisión de la sesión y miss de su contexto", () => {
  const l = log().addAll([selection("d1", { mode: "shadow" }), used("c1", "kmp_trace", "succeeded"), used("c2", "kmp_time", "succeeded")]);
  assert.deepEqual(new ReadLearningStatus(l.store).execute(SessionId.of("s1")), { mode: "shadow", selected: 2, candidates: 4, missRate: 0.5 });
  assert.deepEqual(new ReadLearningStatus(l.store).execute(SessionId.of("otra")), { mode: "shadow", selected: null, candidates: null, missRate: null });
  l.addAll([mode("active", "m"), selection("d2")]);
  assert.deepEqual(new ReadLearningStatus(l.store).execute(SessionId.of("s1")), { mode: "active", selected: 2, candidates: 4, missRate: 0.5 });
});
