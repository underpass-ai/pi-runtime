import { test } from "node:test";
import assert from "node:assert/strict";
import { FactMapper } from "../../../../src/application/mappers/FactMapper.ts";
import { LearningFactFactory } from "../../../../src/application/services/LearningFactFactory.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { LearningContext } from "../../../../src/domain/learning/LearningContext.ts";
import { LearningMode } from "../../../../src/domain/learning/LearningMode.ts";
import { SelectionSize } from "../../../../src/domain/learning/SelectionSize.ts";
import { ToolSelection } from "../../../../src/domain/learning/ToolSelection.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { TelemetryInstanceId } from "../../../../src/domain/telemetry/TelemetryInstanceId.ts";
import { FixedClock } from "../../../support/FixedClock.ts";

const S1 = SessionId.of("s1");

test("el id de tools.selected se fija antes de muestrear y es el del hecho", () => {
  const f = new LearningFactFactory(new FixedClock(1000), "host:42", Actor.of("host", "host:42"));
  const slot = f.slot(S1);
  assert.equal(slot.id.value, "session:s1:tools.selected:select.host_42.1000.0");
  assert.notEqual(f.slot(S1).id.value, slot.id.value);
  const selection = ToolSelection.of({ context: LearningContext.of(Phase.INTERACTIVE, TelemetryInstanceId.of("ecf99390f4089f4f")), mode: LearningMode.SHADOW, control: false,
    size: SelectionSize.DEFAULT, candidates: [ToolName.of("kmp_time")], selected: [ToolName.of("kmp_time")], floor: [ToolName.of("kmp_ask")], seed: slot.id, schemaBytes: { full: 2, exposed: 2 } });
  const fact = f.toolsSelected(S1, slot, selection);
  assert.ok(fact.id.equals(slot.id));
  assert.ok(fact.stream.equals(StreamId.session(S1)));
  assert.equal(fact.occurredAt.epochMs(), 1000);
  assert.equal(fact.actor.kind, "host");
  assert.equal((fact.payload.toValue() as { seed: string }).seed, slot.id.value);
});

test("learning.mode_changed va al stream del host con {from, to, k} y el actor dado", () => {
  const f = new LearningFactFactory(new FixedClock(7000), "cli", Actor.of("human", "underpass-cli"));
  const fact = f.modeChanged(LearningMode.SHADOW, LearningMode.ACTIVE, SelectionSize.of(8));
  assert.ok(fact.stream.equals(StreamId.HOST));
  assert.equal(fact.id.value, "host:learning.mode_changed:mode.cli.7000.0");
  assert.deepEqual(fact.payload.toValue(), { from: "shadow", to: "active", k: 8 });
  assert.deepEqual([fact.actor.kind, fact.actor.id], ["human", "underpass-cli"]);
});

test("FactMapper acepta los dos tipos nuevos sólo en v1", () => {
  const m = new FactMapper();
  const dto = { stream: "session" as const, sessionId: "s1", type: "tools.selected", typeVersion: 1, about: "select.1", occurredAtMs: 1000, actor: { kind: "host", id: "host:1" }, payload: {} };
  assert.equal(m.toDomain(dto).type.value, "tools.selected");
  assert.equal(m.toDomain({ ...dto, stream: "host", sessionId: undefined, type: "learning.mode_changed" }).type.value, "learning.mode_changed");
  assert.throws(() => m.toDomain({ ...dto, typeVersion: 2 }), DomainError);
});
