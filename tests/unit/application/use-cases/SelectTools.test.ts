import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { McpToolMapper } from "../../../../src/application/mappers/McpToolMapper.ts";
import type { ProjectionStore } from "../../../../src/application/ports/ProjectionStore.ts";
import { LearningEvalProjection } from "../../../../src/application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../../../../src/application/projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../../../../src/application/projections/ToolStatsProjection.ts";
import { KnownCatalogs } from "../../../../src/application/services/KnownCatalogs.ts";
import { LearningFactFactory } from "../../../../src/application/services/LearningFactFactory.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { SelectTools } from "../../../../src/application/use-cases/SelectTools.ts";
import { SemVer } from "../../../../src/domain/distribution/SemVer.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { ControlGroup } from "../../../../src/domain/learning/ControlGroup.ts";
import { ServerIdentity } from "../../../../src/domain/mcp/ServerIdentity.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../../../src/domain/mcp/ToolCatalog.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { TelemetryInstanceId } from "../../../../src/domain/telemetry/TelemetryInstanceId.ts";
import { FixedClock } from "../../../support/FixedClock.ts";
import { fact } from "../../../support/recordFixtures.ts";
import { PROJECT, turn, used } from "../../../support/learningFixtures.ts";

const S1 = SessionId.of("s1");
const DESIGN_ALLOWED = PhaseToolSelection.standard().allowed(Phase.DESIGN).map(String);

function host(opts: { project?: TelemetryInstanceId | null; store?: ProjectionStore; catalogs?: KnownCatalogs; slowRefreshMs?: number } = {}) {
  const events = new InMemoryEventStore(); const store = opts.store ?? new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new ToolStatsProjection(), new ToolBanditProjection(), new LearningEvalProjection()]);
  const clock = new FixedClock(1_000);
  const record = new RecordFact(events, clock, () => runner.runOnce());
  const select = new SelectTools(store, record, new LearningFactFactory(clock, "host:1", Actor.of("host", "host:1")), PhaseToolSelection.standard(),
    opts.catalogs ?? new KnownCatalogs(), opts.project === undefined ? TelemetryInstanceId.of(PROJECT) : opts.project, () => { runner.runOnce(); clock.ms += opts.slowRefreshMs ?? 0; });
  return { events, store, record, select, clock, decisions: () => events.readStream(StreamId.session(S1)).filter((r) => r.type.value === "tools.selected").map((r) => ({ id: r.id, p: r.payload.toValue() as Record<string, unknown> })) };
}

test("shadow por defecto: registra la decisión y devuelve el mínimo y las candidatas, siempre dentro de la fase", () => {
  const h = host();
  h.record.execute(fact("session.opened", "o"));
  const interactive = h.select.execute(S1, Phase.INTERACTIVE);
  assert.deepEqual(interactive.mode, "shadow");
  assert.deepEqual(interactive.floor, ["kmp_ask", "kmp_wake"]);
  assert.equal(interactive.selected.length, 11, "11 candidatas ≤ k=12: se exponen todas");
  const design = h.select.execute(S1, Phase.DESIGN);
  assert.equal(design.selected.length, 12);
  assert.ok([...design.selected, ...design.floor].every((t) => DESIGN_ALLOWED.includes(t)));
  assert.ok(!design.selected.includes("kmp_ask") && !design.selected.includes("kmp_wake"));
  const [first, second] = h.decisions();
  assert.deepEqual(first.p.context, { phase: "interactive", project: PROJECT });
  assert.equal(first.p.seed, first.id.value, "la semilla es el event_id del propio hecho");
  assert.deepEqual([second.p.mode, second.p.control, second.p.k, (second.p.candidates as string[]).length], ["shadow", false, 12, 18]);
});

test("aprende: tras decisiones con éxitos y fallos, active con k=4 elige las útiles", () => {
  const h = host();
  h.record.execute(fact("session.opened", "o"));
  const good = ["kmp_guide", "kmp_time", "made_get_help", "made_list_contracts"];
  for (let i = 0; i < 10; i++) {
    const d = h.select.execute(S1, Phase.DESIGN);
    assert.equal(d.mode, "shadow");
    // Los hechos de Pi ocurren después de la decisión (el reloj del host ya avanzó).
    h.record.execute(turn(`t${i}`, undefined, h.clock.ms));
    for (const tool of DESIGN_ALLOWED.filter((t) => !["kmp_ask", "kmp_wake"].includes(t))) h.record.execute(used(`c${i}${tool}`, tool, good.includes(tool) ? "succeeded" : "failed", undefined, h.clock.ms));
  }
  h.record.execute(fact("learning.mode_changed", "m", { from: "shadow", to: "active", k: 4 }, StreamId.HOST));
  const picks = Array.from({ length: 5 }, () => h.select.execute(S1, Phase.DESIGN)).filter((d) => !d.control);
  assert.ok(picks.length > 0);
  for (const d of picks) assert.deepEqual([d.mode, [...d.selected].sort()], ["active", good]);
});

test("control determinista en active: el 10 % mantiene el conjunto completo y queda en el hecho", () => {
  const h = host();
  h.record.execute(fact("session.opened", "o"));
  h.record.execute(fact("learning.mode_changed", "m", { from: "shadow", to: "active", k: 4 }, StreamId.HOST));
  const answers = Array.from({ length: 120 }, () => h.select.execute(S1, Phase.DESIGN));
  const decisions = h.decisions();
  assert.equal(decisions.length, 120);
  decisions.forEach((d, i) => {
    assert.equal(d.p.control, ControlGroup.contains(EventId.of(d.id.value)));
    assert.equal(answers[i].control, d.p.control);
    assert.equal(answers[i].selected.length, 4);
  });
  const controls = answers.filter((a) => a.control).length;
  assert.ok(controls > 0 && controls < 30, String(controls));
});

test("off no decide ni registra; sin sesión abierta o sin id de proyecto responde fallback sin hecho", () => {
  const h = host();
  h.record.execute(fact("learning.mode_changed", "m", { from: "shadow", to: "off", k: 12 }, StreamId.HOST));
  assert.deepEqual(h.select.execute(S1, Phase.DESIGN), { mode: "off", control: false, selected: [], floor: [] });
  h.record.execute(fact("learning.mode_changed", "m2", { from: "off", to: "shadow", k: 12 }, StreamId.HOST));
  const closed = h.select.execute(S1, Phase.INTERACTIVE);
  assert.deepEqual([closed.mode, closed.floor, closed.selected.length], ["fallback", ["kmp_ask", "kmp_wake"], 11]);
  assert.equal(h.decisions().length, 0);
  const anonymous = host({ project: null });
  anonymous.record.execute(fact("session.opened", "o"));
  assert.equal(anonymous.select.execute(S1, Phase.INTERACTIVE).mode, "fallback");
  assert.equal(anonymous.decisions().length, 0);
});

test("si el bandit no se puede leer, fallback sin hecho; si falla la decisión, se registra mode=fallback", () => {
  const inner = new InMemoryProjectionStore();
  let failOn: string | null = null;
  const store: ProjectionStore = {
    cursor: (n) => inner.cursor(n), snapshot: (n) => inner.snapshot(n), commit: (n, e, x, c) => inner.commit(n, e, x, c), reset: (n, v) => inner.reset(n, v),
    quarantine: (n, p, r) => inner.quarantine(n, p, r), quarantined: (n) => inner.quarantined(n),
    load: (n) => { if (n.value === failOn) throw new Error("disk gone"); return inner.load(n); },
  };
  const h = host({ store });
  h.record.execute(fact("session.opened", "o"));
  failOn = ToolBanditProjection.NAME.value;
  assert.equal(h.select.execute(S1, Phase.DESIGN).mode, "fallback");
  assert.equal(h.decisions().length, 0);
  failOn = ToolStatsProjection.NAME.value;
  const d = h.select.execute(S1, Phase.DESIGN);
  assert.deepEqual([d.mode, d.selected.length], ["fallback", 18]);
  assert.deepEqual(h.decisions().map((x) => x.p.mode), ["fallback"]);
});

test("el catálogo conocido quita las tools que ya no existen y da los bytes de esquema", () => {
  const catalogs = new KnownCatalogs();
  const tool = (name: string) => new McpToolMapper().toDomain({ name, description: `${name} tool`, inputSchema: { type: "object" } });
  catalogs.remember(ToolCatalog.of(ServerName.KMP, ServerIdentity.of("kmp", SemVer.of("1.0.0")), ["kmp_ask", "kmp_guide", "kmp_time"].map(tool)));
  const h = host({ catalogs });
  h.record.execute(fact("session.opened", "o"));
  const d = h.select.execute(S1, Phase.DESIGN);
  assert.deepEqual(d.floor, ["kmp_ask"], "kmp_wake desapareció del catálogo de KMP");
  assert.ok(d.selected.includes("kmp_time") && !d.selected.includes("kmp_trace"));
  assert.equal(d.selected.filter((t) => t.startsWith("made_")).length, 7, "sin catálogo de MADE conocido no se filtra");
  const bytes = h.decisions()[0].p.schemaBytes as { full: number; exposed: number };
  const size = (n: string) => catalogs.bytesOf(tool(n).name);
  assert.equal(size("kmp_time"), JSON.stringify({ name: "kmp_time", description: "kmp_time tool", inputSchema: { type: "object" } }).length);
  assert.equal(bytes.full, size("kmp_ask") + size("kmp_guide") + size("kmp_time"), "las de MADE no se conocen: 0");
  assert.equal(catalogs.bytesOf(tool("made_get_help").name), 0);
});

test("un servidor cuyo catálogo falló no aporta candidatas; si luego responde, vuelve a contar", () => {
  const catalogs = new KnownCatalogs();
  catalogs.unavailable(ServerName.MADE);
  const h = host({ catalogs });
  h.record.execute(fact("session.opened", "o"));
  const d = h.select.execute(S1, Phase.DESIGN);
  assert.equal(d.selected.filter((t) => t.startsWith("made_")).length, 0);
  assert.equal(d.selected.length, 11);
  catalogs.remember(ToolCatalog.of(ServerName.MADE, ServerIdentity.of("made", SemVer.of("1.0.0")), [new McpToolMapper().toDomain({ name: "made_get_help", inputSchema: { type: "object" } })]));
  assert.ok(h.select.execute(S1, Phase.DESIGN).selected.includes("made_get_help"));
});

test("plazo de la extensión (spec §7): si el reloj del host ya lo pasó antes de muestrear, fallback con el conjunto completo y sin hecho", () => {
  const h = host({ slowRefreshMs: 500 });
  h.record.execute(fact("session.opened", "o"));
  const late = h.select.execute(S1, Phase.INTERACTIVE, Timestamp.fromEpochMs(h.clock.ms + 100));
  assert.equal(late.mode, "fallback");
  assert.deepEqual(late.floor, ["kmp_ask", "kmp_wake"]);
  assert.equal(late.selected.length, 11, "todas las candidatas: la extensión no reduce");
  assert.equal(h.decisions().length, 0, "Pi ya no espera: no se registra una decisión que no aplicará");
  const onTime = h.select.execute(S1, Phase.INTERACTIVE, Timestamp.fromEpochMs(h.clock.ms + 10_000));
  assert.equal(onTime.mode, "shadow");
  assert.equal(h.decisions().length, 1);
  assert.equal(h.select.execute(S1, Phase.INTERACTIVE).mode, "shadow", "sin plazo, como antes");
});

// Prior de tool_stats (spec §2): la clave con la que tool_stats guarda cada tool es la misma con
// la que SelectTools y el informe la buscan (ToolStatsProjection.key, única fuente).
test("prior de tool_stats: 5 éxitos en otra sesión suben α a 6 y esas tools se llevan la mayoría de los huecos en active", async () => {
  const { LearningReport } = await import("../../../../src/application/use-cases/LearningReport.ts");
  const PRIOR = ["kmp_guide", "kmp_time", "made_get_help", "made_list_contracts"];
  const run = (withStats: boolean) => {
    const h = host();
    const other = StreamId.session(SessionId.of("s0"));
    h.record.execute(fact("session.opened", "o0", {}, other));
    if (withStats) for (const tool of PRIOR) for (let i = 0; i < 5; i++) h.record.execute(used(`p${tool}${i}`, tool, "succeeded", other));
    h.record.execute(fact("learning.mode_changed", "m", { from: "shadow", to: "active", k: 4 }, StreamId.HOST));
    let slots = 0; let prior = 0;
    for (let i = 0; i < 40; i++) {
      const s = SessionId.of(`d${i}`);
      h.record.execute(fact("session.opened", `o${i}`, {}, StreamId.session(s)));
      const d = h.select.execute(s, Phase.DESIGN);
      assert.equal(d.mode, "active");
      slots += d.selected.length; prior += d.selected.filter((t) => PRIOR.includes(t)).length;
    }
    return { share: prior / slots, report: new LearningReport(h.store).execute(Phase.DESIGN) };
  };
  const baseline = run(false); const boosted = run(true);
  // Sin prior, 4 de 16 candidatas: ~25 % de los huecos. Con Beta(6, 1) frente a 12 Beta(1, 1),
  // la mayoría de los huecos (el máximo de 12 uniformes aún les gana a veces).
  assert.ok(baseline.share < 0.4, `sin estadísticas las 4 no dominan: ${baseline.share}`);
  assert.ok(boosted.share > 0.5 && boosted.share > 2 * baseline.share, `con 5 éxitos cada una se llevan la mayoría de los huecos: ${boosted.share} vs ${baseline.share}`);
  const arms = new Map(boosted.report.contexts[0].tools.map((t) => [t.tool, t]));
  for (const tool of PRIOR) assert.deepEqual([arms.get(tool)?.alpha, arms.get(tool)?.beta, arms.get(tool)?.n], [6, 1, 0], tool);
  assert.equal(arms.get("kmp_trace")?.alpha, 1);
  assert.equal(ToolStatsProjection.key("kmp", "kmp_time"), "tool:kmp:kmp_time");
});

// Ruling R7: la extensión manda los nombres de nuestras tools que Pi tiene registradas; la
// decisión nunca elige (ni cuenta en el mínimo) una tool que Pi no expone. Sin el campo, como antes.
test("registered: candidatas y mínimo se limitan a las tools que Pi tiene registradas", () => {
  const h = host();
  h.record.execute(fact("session.opened", "o"));
  const kmpOnly = ["kmp_ask", "kmp_wake", "kmp_guide", "kmp_time", "kmp_trace", "made_nonexistent"].map((n) => ToolName.of(n));
  const d = h.select.execute(S1, Phase.DESIGN, null, kmpOnly);
  assert.deepEqual(d.floor, ["kmp_ask", "kmp_wake"]);
  assert.deepEqual([...d.selected].sort(), ["kmp_guide", "kmp_time", "kmp_trace"]);
  const p = h.decisions()[0].p;
  assert.deepEqual([...(p.candidates as string[])].sort(), ["kmp_guide", "kmp_time", "kmp_trace"], "el hecho sólo lleva lo que Pi podía exponer");
  const none = h.select.execute(S1, Phase.DESIGN, null, []);
  assert.deepEqual([none.floor, none.selected], [[], []]);
  assert.equal(h.select.execute(S1, Phase.DESIGN, null, null).selected.length, 12, "sin el campo, el comportamiento anterior");
});
