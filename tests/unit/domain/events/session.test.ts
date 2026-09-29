import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionAggregate } from "../../../../src/domain/events/SessionAggregate.ts";
import { SessionState } from "../../../../src/domain/events/SessionState.ts";
import { ContinuationSealer } from "../../../../src/domain/events/ContinuationSealer.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { AT, fact } from "../../../support/recordFixtures.ts";

test("decide exige una sesión abierta; session.opened sobre una abierta es una reapertura implícita", () => {
  assert.throws(() => SessionAggregate.decide(SessionState.EMPTY, fact("turn.completed", "t")), DomainError);
  const opened = SessionState.EMPTY.with({ open: true, everOpened: true });
  // Pi murió sin session.closed y la sesión se reanuda (resume): se acepta.
  const again = SessionAggregate.decide(opened, fact("session.opened", "o2", { reason: "resume" }));
  assert.equal(again.type.value, "session.opened");
  assert.ok(SessionAggregate.decide(opened, fact("turn.completed", "t")));
  const reopened = SessionAggregate.decide(opened.with({ open: false }), fact("session.opened", "o3"));
  assert.equal(reopened.type.value, "session.opened");
});

test("fold acumula fase, modelo, turnos, tokens, coste y llamadas; tolera payloads raros", () => {
  const records = ContinuationSealer.seal(null, [
    fact("session.opened", "o", { reason: "startup" }),
    fact("phase.changed", "p", { from: null, to: "interactive" }),
    fact("turn.completed", "t1", { model: "m1", tokens: { input: 10, output: 5, cacheRead: 2 }, cost: 0.5 }),
    fact("turn.completed", "t2", { tokens: { input: "x" }, cost: null }),
    fact("tool.completed", "c1", { server: "kmp", status: "succeeded" }),
    fact("tool.completed", "c2", { server: "kmp", status: "refused" }),
    fact("tool.completed", "c3", {}),
    fact("model.selected", "m", { model: "m2" }),
    fact("session.closed", "x", { reason: "quit" }),
  ], AT);
  const s = SessionAggregate.fold(records);
  assert.deepEqual([s.open, s.everOpened, s.phase, s.model, s.turns, s.tokensIn, s.tokensOut, s.tokensCached, s.cost], [false, true, "interactive", "m2", 2, 10, 5, 2, 0.5]);
  assert.deepEqual(s.calls, { kmp: { succeeded: 1, refused: 1 }, unknown: { unknown: 1 } });
  assert.deepEqual(SessionAggregate.fold(records), s);
});

test("decide devuelve el propio hecho cuando la sesión está abierta (camino de éxito genérico)", () => {
  const opened = SessionState.EMPTY.with({ open: true, everOpened: true });
  const f = fact("phase.changed", "p", { to: "interactive" });
  assert.equal(SessionAggregate.decide(opened, f), f);
});

test("decide rechaza cualquier evento distinto de session.opened cuando la sesión está cerrada", () => {
  assert.throws(() => SessionAggregate.decide(SessionState.EMPTY, fact("phase.changed", "p", { to: "x" })), /requires an open session/);
});

test("apply es infalible: un tipo sin manejador explícito deja el estado sin cambios", () => {
  const before = SessionState.EMPTY.with({ open: true, everOpened: true, phase: "interactive" });
  const compacted = ContinuationSealer.seal(null, [fact("context.compacted", "c")], AT)[0];
  const after = SessionAggregate.apply(before, compacted);
  assert.deepEqual(after, before);
});

test("apply acumula repeticiones del mismo servidor y estado en calls", () => {
  const records = ContinuationSealer.seal(null, [
    fact("session.opened", "o"),
    fact("tool.completed", "c1", { server: "kmp", status: "succeeded" }),
    fact("tool.completed", "c2", { server: "kmp", status: "succeeded" }),
  ], AT);
  const s = SessionAggregate.fold(records);
  assert.deepEqual(s.calls, { kmp: { succeeded: 2 } });
});

test("SessionState.EMPTY tiene los valores iniciales esperados y with() sólo cambia lo indicado", () => {
  assert.deepEqual(
    [SessionState.EMPTY.open, SessionState.EMPTY.everOpened, SessionState.EMPTY.phase, SessionState.EMPTY.model, SessionState.EMPTY.turns, SessionState.EMPTY.tokensIn, SessionState.EMPTY.tokensOut, SessionState.EMPTY.tokensCached, SessionState.EMPTY.cost, SessionState.EMPTY.calls],
    [false, false, null, null, 0, 0, 0, 0, 0, {}],
  );
  const s = SessionState.EMPTY.with({ turns: 3 });
  assert.equal(s.turns, 3);
  assert.equal(s.open, false);
});

test("el agregado coincide con la proyección en una reapertura implícita: sigue abierto, acumula sin reiniciar y cierra al final", () => {
  const records = ContinuationSealer.seal(null, [
    fact("session.opened", "o1"), fact("turn.completed", "t1", { tokens: { input: 1 }, cost: 0.5 }),
    fact("session.opened", "o2", { reason: "resume" }), fact("turn.completed", "t2", { tokens: { input: 1 }, cost: 0.5 }), fact("session.closed", "c"),
  ], AT);
  const reopened = SessionAggregate.fold(records.slice(0, 4));
  assert.deepEqual([reopened.open, reopened.turns, reopened.tokensIn, reopened.cost], [true, 2, 2, 1]);
  const closed = SessionAggregate.apply(reopened, records[4]);
  assert.deepEqual([closed.open, closed.everOpened, closed.turns], [false, true, 2]);
});
