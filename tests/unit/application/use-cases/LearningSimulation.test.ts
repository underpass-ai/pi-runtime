import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import type { SelectionDto } from "../../../../src/application/dto/SelectionDto.ts";
import { LearningEvalProjection } from "../../../../src/application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../../../../src/application/projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../../../../src/application/projections/ToolStatsProjection.ts";
import { KnownCatalogs } from "../../../../src/application/services/KnownCatalogs.ts";
import { LearningFactFactory } from "../../../../src/application/services/LearningFactFactory.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { LearningReport } from "../../../../src/application/use-cases/LearningReport.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { SelectTools } from "../../../../src/application/use-cases/SelectTools.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { TelemetryInstanceId } from "../../../../src/domain/telemetry/TelemetryInstanceId.ts";
import { FixedClock } from "../../../support/FixedClock.ts";
import { fact } from "../../../support/recordFixtures.ts";
import { PROJECT, turn, used } from "../../../support/learningFixtures.ts";

// Simulación offline (spec §10) con el SelectTools y las proyecciones reales sobre un log en
// memoria: 30 candidatas sintéticas más el mínimo fijo en una fase y k = 12. Por petición,
// cada tool útil que el modelo tiene a mano se usa con probabilidad 0,9 y acierta con 0,9;
// cada inútil se usa con 0,005 y falla. Tras 300 decisiones cambia qué tools son útiles.
const CANDIDATES = Array.from({ length: 30 }, (_, i) => `kmp_sim_${String(i).padStart(2, "0")}`);
const BEFORE = new Set(["kmp_sim_03", "kmp_sim_08", "kmp_sim_14", "kmp_sim_21", "kmp_sim_27"]);
const AFTER = new Set(["kmp_sim_01", "kmp_sim_10", "kmp_sim_17", "kmp_sim_24", "kmp_sim_29"]);
const WINDOW = 50;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Un entorno sintético: `decide` pide una selección, simula la petición y devuelve la decisión.
function environment(mode: "shadow" | "active") {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new ToolStatsProjection(), new ToolBanditProjection(), new LearningEvalProjection()]);
  const clock = new FixedClock(1_000);
  const record = new RecordFact(events, clock, () => runner.runOnce());
  const phases = PhaseToolSelection.of([[Phase.DESIGN, ["kmp_ask", "kmp_wake", ...CANDIDATES]]]);
  const select = new SelectTools(store, record, new LearningFactFactory(clock, "sim", Actor.of("host", "sim")), phases, new KnownCatalogs(), TelemetryInstanceId.of(PROJECT), () => runner.runOnce());
  const session = SessionId.of("sim"); const stream = StreamId.session(session);
  const random = mulberry32(42);
  record.execute(fact("session.opened", "o", {}, stream));
  if (mode === "active") record.execute(fact("learning.mode_changed", "m", { from: "shadow", to: "active", k: 12 }, StreamId.HOST));
  let n = 0;
  return {
    store,
    // visible: lo que el modelo puede usar (en shadow y en control, el conjunto completo).
    decide(useful: Set<string>): { decision: SelectionDto; used: string[] } {
      const decision = select.execute(session, Phase.DESIGN);
      assert.equal(decision.mode, mode);
      const visible = decision.mode === "active" && !decision.control ? decision.selected : CANDIDATES;
      const i = n++;
      // Los hechos de Pi ocurren después de la decisión: el reloj ya avanzó.
      record.execute(turn(`t${i}`, stream, clock.ms));
      const usedNow: string[] = [];
      for (const tool of visible) {
        const isUseful = useful.has(tool);
        if (random() >= (isUseful ? 0.9 : 0.005)) continue;
        usedNow.push(tool);
        record.execute(used(`c${i}.${tool}`, tool, isUseful && random() < 0.9 ? "succeeded" : "failed", stream, clock.ms));
      }
      return { decision, used: usedNow };
    },
  };
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

test("shadow: tras 300 decisiones miss < 10 % y ahorro > 50 %; al cambiar la utilidad se adapta en menos de 200", () => {
  const env = environment("shadow");
  const history: { used: number; missed: number }[] = [];
  const step = (useful: Set<string>) => {
    const { decision, used: u } = env.decide(useful);
    assert.equal(decision.selected.length, 12);
    history.push({ used: u.length, missed: u.filter((t) => !decision.selected.includes(t)).length });
  };
  const missRate = (end: number) => {
    const w = history.slice(end - WINDOW, end);
    return w.reduce((s, x) => s + x.missed, 0) / w.reduce((s, x) => s + x.used, 0);
  };
  for (let i = 0; i < 300; i++) step(BEFORE);
  assert.ok(missRate(300) < 0.1, `miss rate de las últimas ${WINDOW} decisiones: ${missRate(300)}`);
  const report = new LearningReport(env.store).execute().contexts[0];
  assert.equal(report.shadow.decisions, 300);
  assert.ok(report.shadow.toolSavings! > 0.5, `ahorro: ${report.shadow.toolSavings}`);
  assert.ok(report.shadow.missRate! < 0.1, `miss rate acumulado: ${report.shadow.missRate}`);
  let adaptedAfter: number | null = null;
  for (let i = 1; i <= 200 && adaptedAfter === null; i++) {
    step(AFTER);
    if (i >= WINDOW && missRate(300 + i) < 0.1) adaptedAfter = i;
  }
  assert.ok(adaptedAfter !== null && adaptedAfter < 200, `adaptación: ${adaptedAfter}`);
});

test("active: las útiles quedan expuestas (≥ 90 %) y, al cambiar la utilidad, las nuevas entran en menos de 200 decisiones", () => {
  const env = environment("active");
  const coverage: number[] = [];
  const step = (useful: Set<string>) => {
    const { decision } = env.decide(useful);
    if (decision.control) { assert.equal(decision.selected.length, 12); return; }
    coverage.push([...useful].filter((t) => decision.selected.includes(t)).length / useful.size);
  };
  for (let i = 0; i < 300; i++) step(BEFORE);
  assert.ok(mean(coverage.slice(-WINDOW)) >= 0.9, `cobertura: ${mean(coverage.slice(-WINDOW))}`);
  const start = coverage.length;
  let adaptedAfter: number | null = null;
  for (let i = 1; i <= 200 && adaptedAfter === null; i++) {
    step(AFTER);
    if (coverage.length - start >= WINDOW && mean(coverage.slice(-WINDOW)) >= 0.9) adaptedAfter = i;
  }
  assert.ok(adaptedAfter !== null && adaptedAfter < 200, `adaptación: ${adaptedAfter}`);
});
