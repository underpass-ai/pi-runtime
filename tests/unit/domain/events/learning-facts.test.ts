import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { ContinuationSealer } from "../../../../src/domain/events/ContinuationSealer.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { SessionAggregate } from "../../../../src/domain/events/SessionAggregate.ts";
import { SessionState } from "../../../../src/domain/events/SessionState.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { SpanAssembler } from "../../../../src/domain/telemetry/SpanAssembler.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const SELECTED = { context: { phase: "design", project: "ecf99390f4089f4f" }, mode: "shadow", control: false, k: 12, candidates: ["kmp_guide", "kmp_time"], selected: ["kmp_time"], floor: ["kmp_ask"], seed: "x", schemaBytes: { full: 10, exposed: 5 } };

test("tools.selected es un hecho de sesión y learning.mode_changed del host", () => {
  assert.ok(EventType.of("tools.selected").belongsToSessions());
  assert.equal(EventType.of("learning.mode_changed").belongsToSessions(), false);
  assert.throws(() => fact("learning.mode_changed", "m", { from: "shadow", to: "active", k: 12 }), DomainError);
  assert.throws(() => fact("tools.selected", "s", SELECTED, StreamId.HOST), DomainError);
});

test("el agregado exige sesión abierta para tools.selected y cuenta las decisiones", () => {
  assert.throws(() => SessionAggregate.decide(SessionState.EMPTY, fact("tools.selected", "s", SELECTED)), DomainError);
  const records = ContinuationSealer.seal(null, [fact("session.opened", "o"), fact("tools.selected", "s1", SELECTED), fact("tools.selected", "s2", {})], AT);
  const s = SessionAggregate.fold(records);
  assert.equal(s.selections, 2);
  assert.equal(SessionState.EMPTY.selections, 0);
  assert.equal(s.with({ turns: 1 }).selections, 2, "with conserva el contador");
});

test("tools.selected es un evento del span de sesión, sin nombres de tools", () => {
  const store = new InMemoryEventStore();
  store.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("tools.selected", "s", SELECTED, SESSION, 1100),
    fact("tools.selected", "raro", { context: "x", control: "yes" }, SESSION, 1200), fact("session.closed", "x", {}, SESSION, 2000)], Timestamp.fromEpochMs(5000));
  const assembler = new SpanAssembler(SpanAssembler.empty());
  const [session] = store.readStream(SESSION).flatMap((r) => assembler.feed(r));
  assert.deepEqual(session.events.map((e) => [e.name, e.attributes.toRecord()]), [
    ["tools.selected", { "pi_runtime.learning.candidates": 2, "pi_runtime.learning.control": false, "pi_runtime.learning.k": 12, "pi_runtime.learning.mode": "shadow",
      "pi_runtime.learning.phase": "design", "pi_runtime.learning.selected": 1 }],
    ["tools.selected", {}],
  ]);
  assert.equal(JSON.stringify(session.events.map((e) => e.attributes.toRecord())).includes("kmp_time"), false);
});
