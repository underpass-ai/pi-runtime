import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { SessionTrace } from "../../../../src/application/use-cases/SessionTrace.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const row = (r: { depth: number; name: string; durationMs: number; status: string; detail: string | null; tokens: unknown; cost: number | null; incomplete: boolean }) =>
  [r.depth, r.name, r.durationMs, r.status, r.detail, r.tokens, r.cost, r.incomplete];

test("árbol de una sesión cerrada: sesión, turnos con sus tools y tools sin turno", () => {
  const events = new InMemoryEventStore();
  events.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", { reason: "startup" }, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 400, status: "succeeded" }, SESSION, 2400),
    fact("turn.completed", "t1", { model: "m", provider: "p", outcome: "completed", tokens: { input: 10, output: 3, cacheRead: 30, cacheWrite: 0 }, cost: 0.25, durationMs: 1500 }, SESSION, 3000),
    fact("tool.completed", "c2", { tool: "kmp_ask", server: "kmp", callId: "c2", durationMs: 20, status: "refused", errorCode: "invalid_argument" }, SESSION, 3100),
    fact("session.closed", "x", { reason: "quit" }, SESSION, 4000),
  ], AT);
  assert.deepEqual(new SessionTrace(events).execute(SessionId.of("s1")).map(row), [
    [0, "session", 3000, "unset", "startup", null, null, false],
    [1, "turn", 1500, "unset", "m completed", { input: 10, output: 3 }, 0.25, false],
    [2, "tool", 400, "unset", "kmp/kmp_ask succeeded", null, null, false],
    [1, "tool", 20, "unset", "kmp/kmp_ask refused", null, null, false],
  ]);
  assert.deepEqual(new SessionTrace(events).execute(SessionId.of("nadie")), []);
});

test("una sesión en curso se muestra con lo abierto como incompleto", () => {
  const events = new InMemoryEventStore(); const s2 = StreamId.session(SessionId.of("s2"));
  events.append(s2, StreamVersion.NONE, [fact("session.opened", "o", {}, s2, 1000), fact("tool.started", "z", { tool: "t", server: "pi", callId: "z" }, s2, 1500)], AT);
  assert.deepEqual(new SessionTrace(events).execute(SessionId.of("s2")).map(row), [
    [0, "session", 500, "unset", null, null, null, true],
    [1, "tool", 0, "unset", "pi/t open", null, null, true],
  ]);
});
