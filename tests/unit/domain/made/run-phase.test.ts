import { test } from "node:test";
import assert from "node:assert/strict";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CeremonyEndReason } from "../../../../src/domain/made/CeremonyEndReason.ts";
import { CeremonyId } from "../../../../src/domain/made/CeremonyId.ts";
import { CeremonySnapshot } from "../../../../src/domain/made/CeremonySnapshot.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { StartedCeremony } from "../../../../src/domain/made/StartedCeremony.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const tool = (n: string) => ToolName.of(n);
const RUN_ONLY = ["made_start_published_ceremony", "made_get_ceremony_instance", "made_claim_ceremony_step", "made_complete_ceremony_step", "made_apply_ceremony_transition"];
const S1 = SessionId.of("s1");
const AT = Timestamp.fromEpochMs(1_000_000);

test("fase run: lo de design más el mínimo para llevar una publicada a su terminal, y nada never", () => {
  const phases = PhaseToolSelection.standard();
  const design = phases.allowed(Phase.DESIGN).map(String); const run = phases.allowed(Phase.RUN).map(String);
  assert.deepEqual(run.filter((n) => !design.includes(n)).sort(), [...RUN_ONLY].sort());
  for (const n of design) assert.ok(run.includes(n), n);
  for (const n of RUN_ONLY) assert.equal(phases.exposes(Phase.DESIGN, tool(n)), false, `${n} no está en design`);
  const policy = MadeActionPolicy.standard();
  for (const n of run.filter((x) => x.startsWith("made_"))) assert.notEqual(policy.classify(tool(n)), MadeActionClass.NEVER, n);
  for (const n of ["made_renew_ceremony_step_lease", "made_bind_ceremony_participants", "made_cancel_ceremony", "made_run_ceremony_step"]) assert.equal(phases.exposes(Phase.RUN, tool(n)), false, `${n}: fuera del mínimo`);
});

test("clases en run: arrancar y las escrituras de ejecución son confirm; leer la instancia, auto", () => {
  const p = MadeActionPolicy.standard();
  for (const n of ["made_start_published_ceremony", "made_claim_ceremony_step", "made_complete_ceremony_step", "made_apply_ceremony_transition"]) assert.equal(p.admits(tool(n), Phase.RUN), MadeActionClass.CONFIRM, n);
  assert.equal(p.admits(tool("made_get_ceremony_instance"), Phase.RUN), MadeActionClass.AUTO);
  assert.equal(p.admits(tool("made_claim_ceremony_step"), Phase.DESIGN), null, "fuera de run no se concede");
  assert.ok(p.startsCeremony(tool("made_start_published_ceremony")));
  assert.ok(!p.startsCeremony(tool("made_start_ceremony")));
  for (const a of ["claim_ceremony_step", "complete_ceremony_step", "apply_ceremony_transition"]) assert.ok(p.executesInstance(MadeAction.of(a)), a);
  for (const a of ["start_published_ceremony", "cancel_ceremony", "get_ceremony_instance", "publish_ceremony_definition"]) assert.ok(!p.executesInstance(MadeAction.of(a)), a);
});

test("retenidas: las escrituras de ejecución fuera de una fase que las exponga, o sin fase conocida", () => {
  const p = MadeActionPolicy.standard();
  for (const phase of [Phase.DESIGN, Phase.INTERACTIVE, null]) assert.ok(p.withheld(tool("made_claim_ceremony_step"), phase), String(phase));
  assert.ok(!p.withheld(tool("made_claim_ceremony_step"), Phase.RUN));
  assert.ok(!p.withheld(tool("made_publish_ceremony_definition"), Phase.INTERACTIVE), "sólo las de ejecución: el resto sigue como en S3a");
  assert.ok(!p.withheld(tool("kmp_ask"), null));
});

test("alcance de instancia: la forma exacta de MADE 0.8.0 y su id", () => {
  const id = CeremonyId.of("smoke-1");
  const scope = MadeScope.ceremony(id);
  assert.deepEqual(scope.toJson(), { kind: "ceremony", ceremony_id: "smoke-1" });
  assert.ok(scope.equals(MadeScope.parse({ kind: "ceremony", ceremony_id: "smoke-1" })));
  assert.ok(scope.ceremonyId()!.equals(id));
  assert.equal(scope.summary(), "ceremony smoke-1");
  assert.equal(MadeScope.GLOBAL.ceremonyId(), null);
  assert.equal(MadeScope.parse({ kind: "definition", name: "x", version: "1.0" }).ceremonyId(), null);
});

test("CeremonyId: identidad acotada, huella estable, y maybe para lo que viene de fuera", () => {
  assert.equal(CeremonyId.of("a").fingerprint(), CeremonyId.of("a").fingerprint());
  assert.match(CeremonyId.of("a").fingerprint(), /^[0-9a-f]{32}$/);
  assert.notEqual(CeremonyId.of("a").fingerprint(), CeremonyId.of("b").fingerprint());
  for (const bad of ["", "x".repeat(257), "a\nb", 7, null]) {
    assert.throws(() => CeremonyId.of(bad as string), DomainError);
    assert.equal(CeremonyId.maybe(bad), null);
  }
  assert.ok(CeremonyId.maybe("ok")!.equals(CeremonyId.of("ok")));
});

test("CeremonySnapshot: id, definición y terminal (lifecycle ended) de lo que devuelve MADE", () => {
  const running = CeremonySnapshot.read({ ceremony_id: "c1", lifecycle: "running", end_reason: null, definition_name: "pi_runtime_run_smoke", definition_version: "1.0" })!;
  assert.ok(!running.ended());
  assert.deepEqual([running.ceremony.value, running.definition, running.version, running.end], ["c1", "pi_runtime_run_smoke", "1.0", null]);
  const ended = CeremonySnapshot.read({ ceremony_id: "c1", lifecycle: "ended", end_reason: "cancelled", definition_name: "bad name\n", definition_version: 1 })!;
  assert.ok(ended.ended());
  assert.equal(ended.end!.value, "cancelled");
  assert.deepEqual([ended.definition, ended.version], [null, null], "lo que no es identidad no se guarda");
  for (const other of [null, "x", [], { ceremony_id: "c1" }, { lifecycle: "ended" }, { ceremony_id: "", lifecycle: "ended" }, { ok: true }]) assert.equal(CeremonySnapshot.read(other), null);
  assert.equal(CeremonySnapshot.read({ ceremony_id: "c1", lifecycle: "ended", end_reason: "Something went wrong!" })!.end, CeremonyEndReason.UNKNOWN);
});

test("StartedCeremony: payload v1 sólo con identidad, ida y vuelta, fin y resumen", () => {
  const snap = CeremonySnapshot.read({ ceremony_id: "smoke-1", lifecycle: "running", definition_name: "pi_runtime_run_smoke", definition_version: "1.0" })!;
  const started = StartedCeremony.from(S1, snap, AT);
  assert.deepEqual(started.toFactPayload(), { ceremonyId: "smoke-1", definition: "pi_runtime_run_smoke", version: "1.0" });
  assert.equal(started.summary(), "ceremony smoke-1 (pi_runtime_run_smoke v1.0)");
  assert.ok(started.running());
  assert.ok(started.scope().equals(MadeScope.ceremony(CeremonyId.of("smoke-1"))));
  const back = StartedCeremony.fromFact(S1, started.toFactPayload(), AT);
  assert.deepEqual(back.toFactPayload(), started.toFactPayload());
  const done = back.ended(CeremonyEndReason.of("completed"));
  assert.ok(!done.running() && done.end!.value === "completed");
  assert.equal(StartedCeremony.fromFact(S1, { ceremonyId: "x", definition: 3, version: "v 1" }, AT).summary(), "ceremony x");
  assert.equal(StartedCeremony.fromFact(S1, { ceremonyId: "x", definition: "d", version: null }, AT).summary(), "ceremony x (d)");
  for (const bad of [null, "x", { ceremonyId: "" }, {}]) assert.throws(() => StartedCeremony.fromFact(S1, bad, AT), DomainError);
});

test("hechos y motivos nuevos de F3: conocidos por esta versión, opacos para una anterior", () => {
  for (const n of ["made.ceremony_started", "made.ceremony_ended"]) {
    assert.ok(EventType.of(n).known() && EventType.of(n).belongsToSessions() && EventType.of(n).madeAudit(), n);
  }
  assert.equal(RevocationReason.of("ceremony_ended"), RevocationReason.CEREMONY_ENDED);
  assert.equal(CeremonyEndReason.of(undefined), CeremonyEndReason.UNKNOWN);
});
