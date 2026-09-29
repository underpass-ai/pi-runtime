import { test } from "node:test";
import assert from "node:assert/strict";
import { LearningEvalProjection } from "../../../../src/application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../../../../src/application/projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../../../../src/application/projections/ToolStatsProjection.ts";
import { LearningFactFactory } from "../../../../src/application/services/LearningFactFactory.ts";
import { ChangeLearningMode } from "../../../../src/application/use-cases/ChangeLearningMode.ts";
import { LearningReport } from "../../../../src/application/use-cases/LearningReport.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { LearningMode } from "../../../../src/domain/learning/LearningMode.ts";
import { SelectionSize } from "../../../../src/domain/learning/SelectionSize.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { FixedClock } from "../../../support/FixedClock.ts";
import { fact } from "../../../support/recordFixtures.ts";
import { LearningLog, PROJECT, selection, turn, used } from "../../../support/learningFixtures.ts";

const log = () => new LearningLog([new ToolStatsProjection(), new ToolBanditProjection(), new LearningEvalProjection()]).add(fact("session.opened", "o"));

test("informe por contexto: tools de la última lista de candidatas con α/β (prior de tool_stats incluido), shadow y active", () => {
  const l = log().addAll([
    used("p1", "kmp_time", "succeeded"), used("p2", "kmp_time", "succeeded"),
    selection("d1", { mode: "shadow", candidates: ["kmp_gone", "kmp_time", "kmp_trace"], selected: ["kmp_time"] }), turn("t0"), used("c0", "kmp_gone", "succeeded"),
    selection("d2", { mode: "shadow" }), turn("t1"), used("c1", "kmp_time", "succeeded"), used("c2", "kmp_trace", "failed"),
    selection("d3"), turn("t2"), used("c3", "kmp_time", "succeeded"),
    selection("d4", { control: true }), turn("t3"), turn("t4"), used("c4", "kmp_guide", "refused"),
    selection("i1", { context: { phase: "interactive", project: PROJECT }, mode: "shadow", candidates: ["kmp_time"], selected: ["kmp_time"] }),
  ]);
  const r = new LearningReport(l.store).execute();
  assert.deepEqual([r.mode, r.k, r.contexts.map((c) => c.phase)], ["shadow", 12, ["design", "interactive"]]);
  const design = r.contexts[0];
  assert.equal(design.project, PROJECT);
  assert.deepEqual(design.tools.map((t) => t.tool), ["kmp_time", "made_get_help", "kmp_guide", "kmp_trace"], "kmp_gone ya no es candidata: no sale");
  const time = design.tools[0];
  assert.deepEqual([time.alpha, time.beta, time.n], [1 + 4 + 2, 1, 2], "4 éxitos en tool_stats (tope 5) + 2 observados");
  assert.ok(Math.abs(time.mean - 7 / 8) < 1e-12);
  assert.deepEqual(design.tools[1], { tool: "made_get_help", mean: 0.5, alpha: 1, beta: 1, n: 0 });
  assert.deepEqual(design.tools[2], { tool: "kmp_guide", mean: 1 / 2.2, alpha: 1, beta: 1.2, n: 1 }, "0 suave de d3 (tratada, no usada); la negativa de d4 no cuenta");
  assert.deepEqual(design.shadow, { decisions: 2, missRate: 2 / 3, toolSavings: 1 - 7 / 11, byteSavings: 0.4 });
  assert.deepEqual(design.treated, { decisions: 1, firstTry: 1, firstTryN: 1, turnsPerRequest: 1, refusalRate: 0 });
  assert.deepEqual(design.control, { decisions: 1, firstTry: 0, firstTryN: 1, turnsPerRequest: 2, refusalRate: 1 });
  assert.deepEqual(new LearningReport(l.store).execute(Phase.INTERACTIVE).contexts.map((c) => c.phase), ["interactive"]);
  const empty = new LearningReport(new LearningLog([]).store).execute();
  assert.deepEqual(empty, { mode: "shadow", k: 12, contexts: [] });
});

test("cambio de modo: from y k salen del último cambio; sin --k se conserva; fallback no se puede fijar", () => {
  const l = new LearningLog([new ToolBanditProjection()]);
  const uc = new ChangeLearningMode(l.events, new RecordFact(l.events, new FixedClock(), () => l.runner.runOnce()), new LearningFactFactory(new FixedClock(), "cli", Actor.of("human", "underpass-cli")));
  assert.deepEqual([uc.current().mode.value, uc.current().k.value], ["shadow", 12]);
  assert.deepEqual(uc.execute(LearningMode.ACTIVE, SelectionSize.of(8)), { from: "shadow", to: "active", k: 8 });
  assert.deepEqual(uc.execute(LearningMode.SHADOW), { from: "active", to: "shadow", k: 8 });
  l.add(fact("learning.mode_changed", "raro", { to: "eager", k: 99 }, StreamId.HOST));
  assert.deepEqual(uc.execute(LearningMode.OFF), { from: "shadow", to: "off", k: 8 });
  assert.throws(() => uc.execute(LearningMode.FALLBACK), DomainError);
  const facts = l.events.readStream(StreamId.HOST).filter((r) => r.type.value === "learning.mode_changed" && r.actor.kind === "human");
  assert.deepEqual(facts.map((r) => r.payload.toValue()), [{ from: "shadow", to: "active", k: 8 }, { from: "active", to: "shadow", k: 8 }, { from: "shadow", to: "off", k: 8 }]);
  assert.deepEqual(new LearningReport(l.store).execute(), { mode: "off", k: 8, contexts: [] });
});
