import { test } from "node:test";
import assert from "node:assert/strict";
import { LearningCli } from "../../../../../src/adapters/inbound/cli/LearningCli.ts";
import { LearningEvalProjection } from "../../../../../src/application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../../../../../src/application/projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../../../../../src/application/projections/ToolStatsProjection.ts";
import { LearningFactFactory } from "../../../../../src/application/services/LearningFactFactory.ts";
import { ChangeLearningMode } from "../../../../../src/application/use-cases/ChangeLearningMode.ts";
import { LearningReport } from "../../../../../src/application/use-cases/LearningReport.ts";
import { ProjectionLag } from "../../../../../src/application/use-cases/ProjectionLag.ts";
import { RecordFact } from "../../../../../src/application/use-cases/RecordFact.ts";
import { Actor } from "../../../../../src/domain/events/Actor.ts";
import { FixedClock } from "../../../../support/FixedClock.ts";
import { fact } from "../../../../support/recordFixtures.ts";
import { LearningLog, PROJECT, selection, turn, used } from "../../../../support/learningFixtures.ts";

function cli(l: LearningLog) {
  const out: string[] = [];
  const projections = [new ToolStatsProjection(), new ToolBanditProjection(), new LearningEvalProjection()];
  const mode = new ChangeLearningMode(l.events, new RecordFact(l.events, new FixedClock(), () => l.runner.runOnce()), new LearningFactFactory(new FixedClock(), "cli", Actor.of("human", "underpass-cli")));
  return { out, cli: new LearningCli({ report: new LearningReport(l.store), mode, lag: new ProjectionLag(l.events, l.store, projections), print: (s) => out.push(s) }) };
}
const world = () => new LearningLog([new ToolStatsProjection(), new ToolBanditProjection(), new LearningEvalProjection()])
  .addAll([fact("session.opened", "o"), selection("d1", { mode: "shadow" }), turn("t"), used("c1", "kmp_time", "succeeded"), selection("d2", { control: true }), used("c2", "kmp_trace", "failed")]);

test("report: modo, tools por contexto y evaluación de shadow y de active", () => {
  const { out, cli: c } = cli(world());
  assert.equal(c.run(["report"]), 0);
  assert.equal(out[0], "mode shadow (k=12)");
  assert.equal(out[1], `context design · project ${PROJECT}`);
  assert.match(out[2], /^  kmp_time\s+mean=0\.750  alpha=3\.00  beta=1\.00  n=1$/, "1 éxito en tool_stats + 1 observado");
  assert.match(out.join("\n"), /  shadow   decisions=1  miss=0\.0%  savings=33\.3% tools, 40\.0% schema bytes/);
  assert.match(out.join("\n"), /  active   treated decisions=0  first-try=- \(n=0\)  turns\/request=-  refusals=-/);
  assert.match(out.join("\n"), /           control decisions=1  first-try=0\.0% \(n=1\)  turns\/request=0\.00  refusals=0\.0%/);
  out.length = 0;
  assert.equal(c.run(["report", "--context", "interactive"]), 0);
  assert.deepEqual(out, ["mode shadow (k=12)", "no learning decisions recorded yet"]);
});

test("report avisa si las proyecciones van por detrás", () => {
  const l = world();
  l.write(fact("tools.selected", "tarde", {}));
  const { out, cli: c } = cli(l);
  assert.equal(c.run(["report"]), 0);
  assert.match(out[0], /^projections behind \(\d+\/\d+\): start pi in this project or run underpass events rebuild tool_bandit$/);
});

test("mode registra el cambio con k entre 4 y 64; el uso incorrecto sale con 2", () => {
  const { out, cli: c } = cli(new LearningLog([new ToolBanditProjection()]));
  assert.equal(c.run(["mode", "active", "--k", "8"]), 0);
  assert.equal(c.run(["mode", "shadow"]), 0);
  assert.deepEqual(out, ["learning mode shadow -> active (k=8)", "learning mode active -> shadow (k=8)"]);
  out.length = 0;
  for (const args of [["mode", "active", "--k", "3"], ["mode", "fallback"], ["mode", "eager"]]) assert.equal(c.run(args), 2, args.join(" "));
  assert.ok(out.every((l) => l.startsWith("error: ")));
  out.length = 0;
  for (const args of [[], ["mode"], ["mode", "active", "--k"], ["mode", "active", "--k", "x"], ["report", "--context"], ["report", "--context", "deploy"], ["nope"]]) assert.equal(c.run(args), 2, args.join(" "));
  assert.ok(out.every((l) => l.startsWith("usage: underpass learning report")), out.join("\n"));
});

test("un fallo del almacén sale con 1 y el mensaje", () => {
  const out: string[] = [];
  const broken = { execute: () => { throw new Error("database is locked"); } };
  const c = new LearningCli({ report: broken as never, mode: broken as never, lag: { execute: () => [] } as never, print: (s) => out.push(s) });
  assert.equal(c.run(["report"]), 1);
  assert.equal(c.run(["mode", "off"]), 1);
  assert.deepEqual(out, ["error: database is locked", "error: database is locked"]);
});
