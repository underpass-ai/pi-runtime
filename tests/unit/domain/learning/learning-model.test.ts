import { test } from "node:test";
import assert from "node:assert/strict";
import { ControlGroup } from "../../../../src/domain/learning/ControlGroup.ts";
import { LearningContext } from "../../../../src/domain/learning/LearningContext.ts";
import { LearningMode } from "../../../../src/domain/learning/LearningMode.ts";
import { SelectionFloor } from "../../../../src/domain/learning/SelectionFloor.ts";
import { SelectionSize } from "../../../../src/domain/learning/SelectionSize.ts";
import { ToolSelection } from "../../../../src/domain/learning/ToolSelection.ts";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { TelemetryInstanceId } from "../../../../src/domain/telemetry/TelemetryInstanceId.ts";

const t = (xs: string[]) => xs.map((x) => ToolName.of(x));
const PROJECT = TelemetryInstanceId.of("ecf99390f4089f4f");

test("modos: off, shadow y active se pueden fijar; fallback sólo lo registra el host", () => {
  assert.equal(LearningMode.DEFAULT, LearningMode.SHADOW);
  assert.equal(LearningMode.of("fallback"), LearningMode.FALLBACK);
  for (const m of ["off", "shadow", "active"]) assert.equal(LearningMode.setting(m).value, m);
  assert.throws(() => LearningMode.setting("fallback"), DomainError);
  assert.throws(() => LearningMode.of("eager"), DomainError);
  assert.throws(() => LearningMode.of(3 as never), DomainError);
});

test("k entre 4 y 64, 12 por defecto", () => {
  assert.equal(SelectionSize.DEFAULT.value, 12);
  assert.equal(SelectionSize.of(4).value, 4);
  assert.equal(SelectionSize.of(64).value, 64);
  for (const bad of [3, 65, 4.5, Number.NaN, "12" as never]) assert.throws(() => SelectionSize.of(bad), DomainError, String(bad));
});

test("contexto (fase, proyecto HMAC) con clave estable y parseo del payload", () => {
  const c = LearningContext.of(Phase.DESIGN, PROJECT);
  assert.equal(c.key, "design|ecf99390f4089f4f");
  assert.deepEqual(c.toJson(), { phase: "design", project: "ecf99390f4089f4f" });
  assert.ok(LearningContext.parse({ phase: "design", project: "ecf99390f4089f4f" }).equals(c));
  for (const bad of [null, [], "design", { phase: "deploy", project: "ecf99390f4089f4f" }, { phase: "design", project: "/home/x" }]) assert.throws(() => LearningContext.parse(bad), DomainError);
});

test("el mínimo fijo sólo entra si la fase lo permite y nunca es candidata", () => {
  const interactive = PhaseToolSelection.standard().allowed(Phase.INTERACTIVE);
  assert.deepEqual(SelectionFloor.STANDARD.within(interactive).map(String), ["kmp_ask", "kmp_wake"]);
  const candidates = SelectionFloor.STANDARD.candidates(interactive).map(String);
  assert.equal(candidates.length, 11);
  assert.ok(!candidates.includes("kmp_ask") && !candidates.includes("kmp_wake"));
  const design = PhaseToolSelection.standard().allowed(Phase.DESIGN).map(String);
  assert.equal(design.length, 22);
  assert.ok(!design.includes("made_claim_ceremony_step"), "los verbos de control de MADE nunca están en una fase");
  const custom = SelectionFloor.of(t(["made_get_status"]));
  assert.deepEqual(custom.within(t(["kmp_ask", "made_get_status"])).map(String), ["made_get_status"]);
  assert.deepEqual(PhaseToolSelection.of([[Phase.INTERACTIVE, ["kmp_b", "kmp_a"]]]).allowed(Phase.INTERACTIVE).map(String), ["kmp_a", "kmp_b"]);
  assert.deepEqual(PhaseToolSelection.of([]).allowed(Phase.DESIGN), []);
  assert.equal(ServerName.owning(ToolName.of("kmp_ask")), ServerName.KMP);
  assert.equal(ServerName.owning(ToolName.of("made_get_help")), ServerName.MADE);
  assert.equal(ServerName.owning(ToolName.of("bash")), null);
});

test("control determinista: el mismo event_id da siempre lo mismo y ~10 % de las decisiones", () => {
  const ids = Array.from({ length: 2000 }, (_, i) => EventId.of(`session:s${i}:tools.selected:select.h.${i}.0`));
  const share = ids.filter((id) => ControlGroup.contains(id)).length / ids.length;
  assert.ok(share > 0.08 && share < 0.12, String(share));
  assert.deepEqual(ids.map((id) => ControlGroup.contains(id)), ids.map((id) => ControlGroup.contains(EventId.of(id.value))));
});

test("una decisión sólo lleva nombres de tools y números, y valida sus invariantes", () => {
  const base = {
    context: LearningContext.of(Phase.INTERACTIVE, PROJECT), mode: LearningMode.ACTIVE, control: false, size: SelectionSize.of(4),
    candidates: t(["kmp_guide", "kmp_time", "kmp_trace"]), selected: t(["kmp_time", "kmp_guide"]), floor: t(["kmp_ask", "kmp_wake"]),
    seed: EventId.of("session:s1:tools.selected:select.h.1.0"), schemaBytes: { full: 500, exposed: 400 },
  };
  const s = ToolSelection.of(base);
  assert.ok(s.narrows());
  assert.deepEqual(s.toPayload(), {
    context: { phase: "interactive", project: "ecf99390f4089f4f" }, mode: "active", control: false, k: 4,
    candidates: ["kmp_guide", "kmp_time", "kmp_trace"], selected: ["kmp_time", "kmp_guide"], floor: ["kmp_ask", "kmp_wake"],
    seed: "session:s1:tools.selected:select.h.1.0", schemaBytes: { full: 500, exposed: 400 },
  });
  assert.equal(ToolSelection.of({ ...base, control: true }).narrows(), false);
  assert.equal(ToolSelection.of({ ...base, mode: LearningMode.SHADOW }).narrows(), false);
  assert.throws(() => ToolSelection.of({ ...base, mode: LearningMode.OFF }), DomainError);
  assert.throws(() => ToolSelection.of({ ...base, mode: LearningMode.SHADOW, control: true }), DomainError);
  assert.throws(() => ToolSelection.of({ ...base, selected: t(["kmp_ask"]) }), DomainError);
  assert.throws(() => ToolSelection.of({ ...base, floor: t(["kmp_time"]) }), DomainError);
  assert.throws(() => ToolSelection.of({ ...base, schemaBytes: { full: -1, exposed: 0 } }), DomainError);
});
