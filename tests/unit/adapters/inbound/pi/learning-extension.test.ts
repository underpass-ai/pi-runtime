import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { HostExtension, PHASE_CHANGED } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import type { SelectionDto } from "../../../../../src/application/dto/SelectionDto.ts";
import type { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import type { SessionId } from "../../../../../src/domain/events/SessionId.ts";
import { Phase } from "../../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";

const OURS = ["kmp_ask", "kmp_wake", "kmp_time", "kmp_trace", "kmp_guide", "made_get_help", "made_design_ceremony", "made_claim_ceremony_step"];

class FakePi {
  handlers = new Map<string, ((e: unknown, ctx: unknown) => unknown)[]>();
  bus = new Map<string, ((d: unknown) => unknown)[]>();
  active = ["read", "bash"];
  sets = 0;
  on(ev: string, h: (e: unknown, ctx: unknown) => unknown) { (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)!).push(h); }
  registerTool() {}
  registerCommand() {}
  getAllTools() { return [...["read", "bash"], ...OURS].map((name) => ({ name })); }
  getActiveTools() { return [...this.active]; }
  setActiveTools(n: string[]) { this.active = n; this.sets++; }
  events = { on: (ev: string, h: (d: unknown) => unknown) => { (this.bus.get(ev) ?? this.bus.set(ev, []).get(ev)!).push(h); }, emit: (ev: string, d: unknown) => { for (const h of this.bus.get(ev) ?? []) h(d); } };
  ctx = { cwd: "/repo", hasUI: false, ui: { notify: () => {} }, sessionManager: { getSessionId: () => "s1" } };
  async fire(ev: string) { for (const h of this.handlers.get(ev) ?? []) await h({ type: ev }, this.ctx); }
}

type Reply = SelectionDto | Error | { delayMs: number; reply: SelectionDto };
function setup(replies: Reply[], opts: { down?: boolean } = {}) {
  const pi = new FakePi(); const calls: { session: string; phase: string }[] = [];
  const gateway = {
    select: async (id: SessionId, phase: Phase) => {
      calls.push({ session: id.value, phase: phase.value });
      const r = replies.shift() ?? { mode: "shadow", control: false, selected: [], floor: [] };
      if (r instanceof Error) throw r;
      if ("delayMs" in r) { await new Promise((res) => setTimeout(res, r.delayMs)); return r.reply; }
      return r;
    },
    onClose: () => {}, close: () => {},
  };
  const host = new HostExtension(async () => { if (opts.down) throw new Error("host down"); return gateway as never; }, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  return { pi, host, calls };
}
const active = (selected: string[], control = false): SelectionDto => ({ mode: "active", control, selected, floor: ["kmp_ask", "kmp_wake"] });
const sorted = (xs: string[]) => [...xs].sort();
const SHADOW: SelectionDto = { mode: "shadow", control: false, selected: [], floor: [] };
const settle = () => new Promise((r) => setTimeout(r, 10));
const FULL_INTERACTIVE = ["bash", "kmp_ask", "kmp_guide", "kmp_time", "kmp_trace", "kmp_wake", "read"];
const NARROWED = ["bash", "kmp_ask", "kmp_time", "kmp_wake", "read"];

test("active sin control aplica floor ∪ selected ∪ tools de Pi, dentro de la fase; control y shadow restauran el conjunto completo", async () => {
  const { pi, host, calls } = setup([active(["kmp_time", "made_get_help"]), active(["kmp_trace"], true), active(["kmp_trace"]), { mode: "shadow", control: false, selected: ["kmp_time"], floor: [] }]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.DESIGN);
  await settle();
  assert.deepEqual(calls, [{ session: "s1", phase: "design" }], "el cambio de fase decide");
  assert.deepEqual(sorted(pi.active), ["bash", "kmp_ask", "kmp_time", "kmp_wake", "made_get_help", "read"]);
  await pi.fire("agent_start");
  assert.deepEqual(sorted(pi.active), ["bash", "kmp_ask", "kmp_guide", "kmp_time", "kmp_trace", "kmp_wake", "made_design_ceremony", "made_get_help", "read"], "control: conjunto completo de la fase");
  assert.ok(!pi.active.includes("made_claim_ceremony_step"));
  await pi.fire("agent_start");
  assert.deepEqual(sorted(pi.active), ["bash", "kmp_ask", "kmp_trace", "kmp_wake", "read"]);
  await pi.fire("agent_start");
  assert.equal(pi.active.length, 9, "shadow restaura el conjunto completo");
  assert.equal(calls.length, 4);
});

test("una fase repetida no decide dos veces; sin sesión no se decide", async () => {
  const { pi, host, calls } = setup([]);
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await pi.fire("agent_start");
  assert.equal(calls.length, 0, "sin session_start no hay sesión");
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE); host.applyPhase(pi as never, Phase.INTERACTIVE);
  pi.events.emit(PHASE_CHANGED, null);
  await settle();
  assert.deepEqual(calls.map((c) => c.phase), ["interactive", "interactive"], "la primera emisión y la de fase desconocida; la repetida no");
});

test("timeout de 200 ms: Pi no espera más, sigue con el conjunto completo y la respuesta tardía se ignora", async () => {
  const { pi, host } = setup([SHADOW, { delayMs: 600, reply: active(["kmp_time"]) }]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await settle();
  const before = sorted(pi.active);
  const sets = pi.sets;
  const t0 = Date.now();
  await host.learn(pi as never);
  const waited = Date.now() - t0;
  assert.ok(waited >= 190 && waited < 400, String(waited));
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(sorted(pi.active), before);
  assert.equal(pi.sets, sets);
});

test("si conectar con el host agota los 200 ms, select ni se envía: ninguna decisión queda registrada", async () => {
  const pi = new FakePi(); let selects = 0;
  const gateway = { select: async () => { selects++; return SHADOW; }, onClose: () => {}, close: () => {} };
  const host = new HostExtension(async () => { await new Promise((r) => setTimeout(r, 400)); return gateway as never; }, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  const starting = pi.fire("session_start");
  await new Promise((r) => setTimeout(r, 10));
  const t0 = Date.now();
  await host.learn(pi as never);
  assert.ok(Date.now() - t0 < 300);
  await starting;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(selects, 0);
});

test("un error o el host caído dejan el conjunto completo, también tras una decisión que redujo", async () => {
  const { pi, host } = setup([SHADOW, active(["kmp_time"]), new Error("boom")]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await settle();
  await pi.fire("agent_start");
  assert.deepEqual(sorted(pi.active), NARROWED);
  await pi.fire("agent_start");
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE);
  const down = setup([], { down: true });
  await down.pi.fire("session_start");
  down.host.applyPhase(down.pi as never, Phase.INTERACTIVE);
  await settle();
  const t0 = Date.now();
  await down.pi.fire("agent_start");
  assert.ok(Date.now() - t0 < 250);
  assert.deepEqual(sorted(down.pi.active), FULL_INTERACTIVE);
  assert.equal(down.calls.length, 0);
});

test("una respuesta que llega tras cambiar de fase o de sesión no se aplica", async () => {
  const { pi, host } = setup([{ delayMs: 50, reply: active(["kmp_time"]) }]);
  await pi.fire("session_start");
  const pending = host.learn(pi as never);
  host.applyPhase(pi as never, Phase.DESIGN);
  await pending;
  assert.ok(pi.active.includes("made_design_ceremony"));
  await pi.fire("session_shutdown");
  assert.equal(await host.learn(pi as never), undefined);
});

// Casos de fallo de la extensión (carry-over de Task 7): una negativa `ok:false` del host llega
// como HostCallError, que bajo Pi viene de otro realm de jiti; todos restauran el conjunto completo.
async function narrowedThen(failure: (g: { select: () => Promise<SelectionDto> }) => void) {
  const { pi, host } = setup([SHADOW, active(["kmp_time"])]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await settle();
  await pi.fire("agent_start");
  assert.deepEqual(sorted(pi.active), NARROWED, "precondición: una decisión redujo las tools");
  const g = await host.gateway() as unknown as { select: () => Promise<SelectionDto> };
  failure(g);
  const t0 = Date.now();
  await assert.doesNotReject(pi.fire("agent_start"));
  assert.ok(Date.now() - t0 < 250);
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE);
  return { pi, host };
}

test("una negativa del host (ok:false → HostCallError de otro realm) restaura el conjunto completo sin lanzar", async () => {
  const url = pathToFileURL(new URL("../../../../../src/application/ports/HostCallError.ts", import.meta.url).pathname).href;
  const foreign = (await import(`${url}?realm=host`)).HostCallError as typeof HostCallError;
  await narrowedThen((g) => { g.select = async () => { throw new foreign("invalid", "unknown session", "bad_request"); }; });
});

test("un gateway que lanza en síncrono al llamar a select restaura el conjunto completo sin lanzar", async () => {
  await narrowedThen((g) => { g.select = () => { throw new Error("sync boom"); }; });
});

test("el timeout tras una decisión que redujo restaura el conjunto completo en 200 ms", async () => {
  await narrowedThen((g) => { g.select = () => new Promise((r) => setTimeout(() => r(active(["kmp_time"])), 400)); });
  await new Promise((r) => setTimeout(r, 450));
});

test("sin gateway (host caído tras reducir y reconexión fallida) restaura el conjunto completo", async () => {
  const pi = new FakePi(); let closed: (() => void) | null = null; let down = false;
  const gateway = { select: async () => active(["kmp_time"]), onClose: (l: () => void) => { closed = l; }, close: () => {} };
  const host = new HostExtension(async () => { if (down) throw new Error("host down"); return gateway as never; }, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await settle();
  assert.deepEqual(sorted(pi.active), NARROWED);
  down = true; closed!();
  await assert.doesNotReject(pi.fire("agent_start"));
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE);
});

test("una respuesta malformada o un setActiveTools que lanza no rompen Pi", async () => {
  const { pi, host } = setup([SHADOW, { mode: "active", control: false, selected: null, floor: null } as unknown as SelectionDto, active(["kmp_time"])]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await settle();
  await assert.doesNotReject(pi.fire("agent_start"));
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE);
  pi.setActiveTools = () => { throw new Error("pi refused"); };
  await assert.doesNotReject(pi.fire("agent_start"));
});

test("fases iguales de realms distintos (Phase de otra copia del módulo) no descartan la decisión", async () => {
  const url = pathToFileURL(new URL("../../../../../src/domain/session/Phase.ts", import.meta.url).pathname).href;
  const ForeignPhase = (await import(`${url}?realm=kmp`)).Phase as typeof Phase;
  assert.notEqual(ForeignPhase, Phase);
  const { pi, host } = setup([{ delayMs: 30, reply: active(["kmp_time"]) }]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, ForeignPhase.INTERACTIVE); // decide en segundo plano (30 ms)
  host.applyPhase(pi as never, Phase.INTERACTIVE); // el otro servidor: misma fase, no decide otra vez
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(sorted(pi.active), NARROWED);
});
