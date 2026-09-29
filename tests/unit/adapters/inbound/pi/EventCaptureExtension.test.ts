import { test } from "node:test";
import assert from "node:assert/strict";
import { EventCaptureExtension } from "../../../../../src/adapters/inbound/pi/EventCaptureExtension.ts";
import { PiEventFactMapper } from "../../../../../src/adapters/inbound/pi/PiEventFactMapper.ts";
import { HOST_READY, PHASE_CHANGED } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import type { FactDto } from "../../../../../src/application/dto/FactDto.ts";

class FakePi {
  handlers = new Map<string, ((e: unknown, ctx: unknown) => unknown)[]>(); bus = new Map<string, ((d: unknown) => unknown)[]>();
  on(ev: string, h: (e: unknown, ctx: unknown) => unknown) { (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)!).push(h); }
  events = { on: (ev: string, h: (d: unknown) => unknown) => { (this.bus.get(ev) ?? this.bus.set(ev, []).get(ev)!).push(h); }, emit: (ev: string, d: unknown) => { for (const h of this.bus.get(ev) ?? []) h(d); } };
  ctx = { cwd: "/repo", hasUI: false, ui: { notify() {} }, sessionManager: { getSessionId: () => "s1" }, getContextUsage: () => ({ tokens: 1200 }) };
  fire(ev: string, e: unknown) { for (const h of this.handlers.get(ev) ?? []) h(e, this.ctx); }
  registerTool() {} registerCommand() {} getAllTools() { return []; } getActiveTools() { return []; } setActiveTools() {}
}

test("ciclo de una sesión: hechos en orden, flush al HOST_READY y cierre", () => {
  const pi = new FakePi(); const facts: FactDto[] = []; let flushed = 0; let t = 1000;
  const sink = { record: (f: FactDto) => { facts.push(f); }, flush: async () => { flushed++; } };
  new EventCaptureExtension(() => sink, new PiEventFactMapper("pi:1", "0.1.0"), () => t++).register(pi as never);
  pi.fire("session_start", { type: "session_start", reason: "startup" });
  pi.events.emit(HOST_READY, null);
  pi.events.emit(PHASE_CHANGED, { phase: "interactive", activeTools: ["kmp_ask"] });
  pi.fire("turn_start", { turnIndex: 0, timestamp: 500 });
  pi.fire("tool_execution_start", { toolCallId: "c1", toolName: "kmp_ask", args: {} });
  pi.fire("tool_execution_end", { toolCallId: "c1", toolName: "kmp_ask", isError: false, result: { content: [] } });
  pi.fire("turn_end", { message: { role: "assistant", model: "m", provider: "p", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } }, outcome: "completed", messageEntryId: "e1" });
  pi.fire("model_select", { model: { id: "m2", provider: "p" }, source: "set" });
  pi.fire("session_compact", { compactionEntry: { id: "k1", tokensBefore: 9000 }, reason: "manual" });
  pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
  assert.deepEqual(facts.map((f) => f.type), ["session.opened", "phase.changed", "tool.started", "tool.completed", "turn.completed", "model.selected", "context.compacted", "session.closed"]);
  assert.equal(flushed, 1);
  assert.equal(facts[4].payload.durationMs, 1004 - 500);
  assert.equal(facts[6].payload.tokensAfter, 1200);
  pi.fire("turn_start", {});
  pi.fire("tool_execution_start", { toolCallId: "x", toolName: "bash", args: {} });
  assert.equal(facts.length, 8);
});

test("sin id de sesión no se captura nada", () => {
  const pi = new FakePi(); pi.ctx.sessionManager = undefined as never; const facts: FactDto[] = [];
  new EventCaptureExtension(() => ({ record: (f: FactDto) => { facts.push(f); }, flush: async () => {} }), new PiEventFactMapper("pi:1", "0.1.0")).register(pi as never);
  pi.fire("session_start", { reason: "startup" });
  assert.equal(facts.length, 0);
});

test("eventos sin sesión, sin datos o fuera de orden no rompen ni inventan hechos", () => {
  const pi = new FakePi(); const facts: FactDto[] = []; let flushed = 0;
  (pi.ctx as { getContextUsage: unknown }).getContextUsage = () => undefined;
  new EventCaptureExtension(() => ({ record: (f: FactDto) => { facts.push(f); }, flush: async () => { flushed++; } }), new PiEventFactMapper("pi:1", "0.1.0"), () => 50).register(pi as never);
  pi.events.emit(HOST_READY, null); // sin sesión: sin sink que vaciar
  pi.events.emit(PHASE_CHANGED, { phase: "interactive" });
  for (const ev of ["turn_end", "tool_execution_start", "tool_execution_end", "model_select", "session_compact", "session_shutdown"]) pi.fire(ev, {});
  assert.deepEqual([facts.length, flushed], [0, 0]);
  pi.fire("session_start", {});
  pi.events.emit(PHASE_CHANGED, { phase: "design", activeTools: "x" });
  pi.fire("turn_start", {});
  pi.fire("turn_end", { message: { role: "user" } });
  pi.fire("tool_execution_end", { toolCallId: "sin-inicio", toolName: "bash", isError: false });
  pi.fire("model_select", {});
  pi.fire("session_compact", { compactionEntry: { id: "k", tokensBefore: 5 } });
  pi.fire("session_shutdown", {});
  assert.deepEqual(facts.map((f) => f.type), ["session.opened", "phase.changed", "tool.completed", "context.compacted", "session.closed"]);
  assert.deepEqual([facts[0].payload.reason, facts[1].payload.activeTools, facts[1].payload.from, facts[2].payload.durationMs, facts[3].payload.tokensAfter, facts[4].payload.reason], ["startup", 0, null, null, null, "quit"]);
});

test("session_shutdown espera a entregar session.closed antes de que el host cierre el gateway", async () => {
  const pi = new FakePi(); const log: string[] = [];
  const sink = { record: (f: FactDto) => { log.push(`record ${f.type}`); }, flush: async () => { await new Promise((r) => setTimeout(r, 10)); log.push("flushed"); } };
  new EventCaptureExtension(() => sink, new PiEventFactMapper("pi:1", "0.1.0")).register(pi as never);
  pi.fire("session_start", { reason: "startup" });
  await pi.handlers.get("session_shutdown")![0]({ reason: "quit" }, pi.ctx);
  assert.deepEqual(log, ["record session.opened", "record session.closed", "flushed"]);
});

test("session_shutdown no se cuelga si el host no responde", async () => {
  const pi = new FakePi();
  const sink = { record: () => {}, flush: () => new Promise<void>(() => {}) };
  new EventCaptureExtension(() => sink, new PiEventFactMapper("pi:1", "0.1.0"), () => 1, 10).register(pi as never);
  pi.fire("session_start", {});
  const t0 = Date.now();
  await pi.handlers.get("session_shutdown")![0]({}, pi.ctx);
  assert.ok(Date.now() - t0 < 1000);
});

test("un sink que no se puede crear o que lanza no rompe los handlers ni applyPhase", () => {
  const pi = new FakePi();
  new EventCaptureExtension(() => { throw new Error("EACCES spool"); }, new PiEventFactMapper("pi:1", "0.1.0")).register(pi as never);
  assert.doesNotThrow(() => pi.fire("session_start", {}));
  assert.doesNotThrow(() => pi.events.emit(PHASE_CHANGED, { phase: "design", activeTools: [] }));
  const pi2 = new FakePi();
  new EventCaptureExtension(() => ({ record: () => { throw new Error("ENOSPC"); }, flush: async () => { throw new Error("x"); } }), new PiEventFactMapper("pi:1", "0.1.0")).register(pi2 as never);
  assert.doesNotThrow(() => pi2.fire("session_start", {}));
  assert.doesNotThrow(() => pi2.events.emit(PHASE_CHANGED, { phase: "design", activeTools: [] }));
  assert.doesNotThrow(() => pi2.events.emit(HOST_READY, null));
});

test("fase repetida y tools sin toolCallId no emiten hechos", () => {
  const pi = new FakePi(); const facts: FactDto[] = [];
  new EventCaptureExtension(() => ({ record: (f: FactDto) => { facts.push(f); }, flush: async () => {} }), new PiEventFactMapper("pi:1", "0.1.0"), () => 1).register(pi as never);
  pi.fire("session_start", {});
  pi.events.emit(PHASE_CHANGED, { phase: "interactive", activeTools: [] });
  pi.events.emit(PHASE_CHANGED, { phase: "interactive", activeTools: ["kmp_ask"] });
  pi.events.emit(PHASE_CHANGED, { phase: "design", activeTools: [] });
  pi.fire("tool_execution_start", { toolName: "bash", args: {} });
  pi.fire("tool_execution_end", { toolName: "bash", isError: false });
  pi.fire("tool_execution_start", { toolCallId: "", toolName: "bash" });
  assert.deepEqual(facts.map((f) => `${f.type}:${f.payload.to ?? ""}`), ["session.opened:", "phase.changed:interactive", "phase.changed:design"]);
});
