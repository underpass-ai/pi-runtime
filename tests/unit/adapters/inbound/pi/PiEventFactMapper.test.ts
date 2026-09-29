import { test } from "node:test";
import assert from "node:assert/strict";
import { PiEventFactMapper } from "../../../../../src/adapters/inbound/pi/PiEventFactMapper.ts";
import { FactMapper } from "../../../../../src/application/mappers/FactMapper.ts";

const m = new PiEventFactMapper("pi:7", "0.1.0", "0.87.1");
const SECRET = "sk-THIS-MUST-NOT-LEAK /home/user/secret.txt";

test("tool.started y tool.completed solo llevan metadatos y digests", () => {
  const started = m.toolStarted("s1", { toolCallId: "call:1", toolName: "kmp_ask", args: { q: SECRET } }, 1000);
  const done = m.toolCompleted("s1", { toolCallId: "call:1", toolName: "kmp_ask", isError: false, result: { content: [{ type: "text", text: SECRET }] } }, 1000, 1250);
  for (const f of [started, done]) {
    assert.equal(JSON.stringify(f).includes("sk-THIS"), false);
    assert.equal(JSON.stringify(f).includes("/home/user"), false);
    new FactMapper().toDomain(f);
  }
  assert.deepEqual([started.about, done.about], ["tool.call:1.started", "tool.call:1.completed"]);
  assert.deepEqual([done.payload.server, done.payload.status, done.payload.durationMs, typeof done.payload.outputDigest], ["kmp", "succeeded", 250, "string"]);
  assert.match(String(started.payload.argsDigest), /^[0-9a-f]{64}$/);
});

test("clasifica negativas, abortos y errores de tool", () => {
  const txt = (text: string) => ({ content: [{ type: "text", text }] });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt("kmp_ask refused (not_found): no such ref")), { status: "refused", errorKind: "refused", errorCode: "not_found" });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt("made_x transport (-): host connection closed")), { status: "failed", errorKind: "transport", errorCode: null });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt("kmp_ask aborted; outcome unknown")), { status: "aborted", errorKind: "aborted", errorCode: null });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt("ENOENT")), { status: "failed", errorKind: "tool_error", errorCode: null });
  assert.deepEqual(PiEventFactMapper.outcomeOf(false, txt("ok")), { status: "succeeded", errorKind: null, errorCode: null });
  assert.deepEqual([PiEventFactMapper.serverOf("made_claim"), PiEventFactMapper.serverOf("bash")], ["made", "pi"]);
});

test("turn_end usa el uso del mensaje del asistente y descarta otros roles", () => {
  const ev = { message: { role: "assistant", model: "claude-x", provider: "anthropic", stopReason: "stop", content: [{ type: "text", text: SECRET }],
    usage: { input: 10, output: 3, cacheRead: 5, cacheWrite: 1, totalTokens: 19, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } } },
    outcome: "completed", messageEntryId: "e/1" };
  const f = m.turnCompleted("s1", ev, 900, 1000)!;
  assert.equal(JSON.stringify(f).includes("sk-THIS"), false);
  assert.deepEqual(f.payload, { model: "claude-x", provider: "anthropic", tokens: { input: 10, output: 3, cacheRead: 5, cacheWrite: 1 }, cost: 0.01, durationMs: 100, outcome: "completed", stopReason: "stop" });
  assert.equal(f.about, "turn.e_1");
  assert.equal(m.turnCompleted("s1", { message: { role: "user" } }, null, 1), null);
});

test("sesión, fase, modelo y compaction", () => {
  assert.deepEqual(m.sessionOpened("s1", "startup", 5, "41ae276521aaee43").payload, { reason: "startup", piRuntimeVersion: "0.1.0", piVersion: "0.87.1", project: "41ae276521aaee43" });
  assert.equal(new PiEventFactMapper("pi:7", "0.1.0", null).sessionOpened("s1", "resume", 5, "p").payload.piVersion, null);
  assert.deepEqual(m.phaseChanged("s1", null, "interactive", ["kmp_ask", "bash"], 6).payload.activeTools, 2);
  assert.deepEqual(m.modelSelected("s1", { model: { id: "m", provider: "p" }, source: "set" }, 7, "high")!.payload, { model: "m", provider: "p", source: "set", effort: "high" });
  assert.equal(m.modelSelected("s1", { model: { id: "m" } }, 7, null)!.payload.effort, null);
  assert.equal(m.modelSelected("s1", {}, 7, "high"), null);
  assert.deepEqual(m.compacted("s1", { compactionEntry: { id: "c1", tokensBefore: 9000 }, reason: "threshold" }, 1200, 8)!.payload, { tokensBefore: 9000, tokensAfter: 1200, reason: "threshold" });
});

test("valores ausentes: nulos, about por instante y abouts saneados", () => {
  assert.equal(m.compacted("s1", {}, null, 8), null);
  assert.equal(m.compacted("s1", { compactionEntry: { tokensBefore: 1 } }, null, 8)!.about, "compact.8");
  const t = m.turnCompleted("s1", { message: { role: "assistant" } }, null, 9)!;
  assert.deepEqual([t.about, t.payload.durationMs, t.payload.model, t.payload.cost], ["turn.9", null, null, 0]);
  const done = m.toolCompleted("s1", { toolCallId: "a b/c", toolName: "bash", isError: true, result: "plain" }, null, 3);
  assert.deepEqual([done.about, done.payload.durationMs, done.payload.server, done.payload.status], ["tool.a_b_c.completed", null, "pi", "failed"]);
  assert.equal(m.toolStarted("s1", { toolCallId: "x".repeat(300) }, 1).about.length, 200);
  assert.equal(m.toolStarted("s1", { toolCallId: "c" }, 1).payload.tool, "unknown");
  assert.equal(m.sessionClosed("s1", "quit", 4).about, "closed.4");
  assert.deepEqual(PiEventFactMapper.digest(undefined), PiEventFactMapper.digest(null));
  assert.equal(PiEventFactMapper.digest("é").bytes, 4);
  assert.equal(PiEventFactMapper.serverOf("kmp_ask"), "kmp");
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, { content: "no array" }), { status: "failed", errorKind: "tool_error", errorCode: null });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, { content: [{ type: "image" }, { type: "text", text: "made_x denied (policy): no" }] }), { status: "refused", errorKind: "denied", errorCode: "policy" });
  const p = m.phaseChanged("s1", "interactive", "design", ["b", "a"], 6);
  assert.equal(p.payload.activeToolsDigest, m.phaseChanged("s1", null, "design", ["a", "b"], 7).payload.activeToolsDigest);
  assert.equal(JSON.stringify(p).includes("\"a\""), false);
});

test("errorCode nunca lleva texto libre: sólo tools de kmp/made y códigos cortos", () => {
  const txt = (text: string) => ({ content: [{ type: "text", text }] });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt("kmp_ask refused (/home/user/secret.txt): no")), { status: "failed", errorKind: "tool_error", errorCode: null });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt(`made_x rpc (${"a".repeat(65)}): no`)), { status: "failed", errorKind: "tool_error", errorCode: null });
  assert.deepEqual(PiEventFactMapper.outcomeOf(true, txt("made_x rpc (-32602): bad params")), { status: "failed", errorKind: "rpc", errorCode: "-32602" });
  const bash = m.toolCompleted("s1", { toolCallId: "c", toolName: "bash", isError: true, result: txt("kmp_ask refused (sk-THIS): x") }, null, 1);
  assert.deepEqual([bash.payload.errorKind, bash.payload.errorCode, JSON.stringify(bash).includes("sk-THIS")], ["tool_error", null, false]);
  const leak = m.toolCompleted("s1", { toolCallId: "c", toolName: "kmp_ask", isError: true, result: txt("kmp_ask refused (/home/user/x): x") }, null, 1);
  assert.equal(JSON.stringify(leak).includes("/home/user"), false);
});
