import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { HostExtension, PHASE_CHANGED } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import type { SelectionDto } from "../../../../../src/application/dto/SelectionDto.ts";
import type { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import type { SessionId } from "../../../../../src/domain/events/SessionId.ts";
import type { Timestamp } from "../../../../../src/domain/events/Timestamp.ts";
import type { ToolName } from "../../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";

// Sin márgenes de reloj: las respuestas lentas son promesas que el test resuelve a mano, el
// plazo se inyecta (SHORT en los tests de plazo, LONG en el resto, que nunca lo alcanzan) y se
// comprueba el orden de los hechos, no cuánto tardan. La única cota de tiempo es holgada (1 s).
const SHORT = 30; const LONG = 10_000; const LENIENT_MS = 1_000;
const OURS = ["kmp_ask", "kmp_wake", "kmp_time", "kmp_trace", "kmp_guide", "made_get_help", "made_design_ceremony", "made_claim_ceremony_step"];
const FULL_INTERACTIVE = ["bash", "kmp_ask", "kmp_guide", "kmp_time", "kmp_trace", "kmp_wake", "read"];
const NARROWED = ["bash", "kmp_ask", "kmp_time", "kmp_wake", "read"];

class FakePi {
  handlers = new Map<string, ((e: unknown, ctx: unknown) => unknown)[]>();
  bus = new Map<string, ((d: unknown) => unknown)[]>();
  active = ["read", "bash"];
  sets = 0; notices: string[] = []; sid = "s1"; ours = [...OURS];
  on(ev: string, h: (e: unknown, ctx: unknown) => unknown) { (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)!).push(h); }
  registerTool() {}
  registerCommand() {}
  getAllTools() { return [...["read", "bash"], ...this.ours].map((name) => ({ name })); }
  getActiveTools() { return [...this.active]; }
  setActiveTools(n: string[]) { this.active = n; this.sets++; }
  events = { on: (ev: string, h: (d: unknown) => unknown) => { (this.bus.get(ev) ?? this.bus.set(ev, []).get(ev)!).push(h); }, emit: (ev: string, d: unknown) => { for (const h of this.bus.get(ev) ?? []) h(d); } };
  // hasUI: el aviso de host caído va a notify (silencioso), no a console.error.
  ctx = { cwd: "/repo", hasUI: true, ui: { notify: (m: string) => { this.notices.push(m); } }, sessionManager: { getSessionId: () => this.sid } };
  async fire(ev: string) { for (const h of this.handlers.get(ev) ?? []) await h({ type: ev }, this.ctx); }
}

class Deferred<T> {
  resolve!: (v: T) => void; reject!: (e: unknown) => void;
  readonly promise = new Promise<T>((res, rej) => { this.resolve = res; this.reject = rej; });
}

type Reply = SelectionDto | Error | Deferred<SelectionDto> | (() => SelectionDto);
type Call = { session: string; phase: string; deadline: Timestamp | undefined; registered: string[] | undefined };
function setup(replies: Reply[], opts: { timeoutMs?: number } = {}) {
  const pi = new FakePi(); const calls: Call[] = []; const state = { down: false, closed: null as (() => void) | null };
  const gateway = {
    select: (id: SessionId, phase: Phase, deadline?: Timestamp, registered?: ToolName[]): Promise<SelectionDto> => {
      calls.push({ session: id.value, phase: phase.value, deadline, registered: registered?.map((t) => t.value) });
      const r = replies.shift() ?? SHADOW;
      if (typeof r === "function") return Promise.resolve().then(r);
      if (r instanceof Error) return Promise.reject(r);
      if (r instanceof Deferred) return r.promise;
      return Promise.resolve(r);
    },
    onClose: (l: () => void) => { state.closed = l; }, close: () => {},
  };
  const host = new HostExtension(async () => { if (state.down) throw new Error("host down"); return gateway as never; }, new SelectPhaseTools(PhaseToolSelection.standard()), opts.timeoutMs ?? LONG);
  host.register(pi as never);
  return { pi, host, calls, gateway, state };
}
const active = (selected: string[], control = false): SelectionDto => ({ mode: "active", control, selected, floor: ["kmp_ask", "kmp_wake"] });
const sorted = (xs: string[]) => [...xs].sort();
const SHADOW: SelectionDto = { mode: "shadow", control: false, selected: [], floor: [] };
// Deja correr las microtareas y los callbacks de E/S pendientes (sin esperar a ningún plazo).
const flush = () => new Promise((r) => setImmediate(r));
async function started(replies: Reply[], opts: { timeoutMs?: number } = {}) {
  const s = setup([SHADOW, ...replies], opts);
  await s.pi.fire("session_start");
  s.host.applyPhase(s.pi as never, Phase.INTERACTIVE); // primera decisión (SHADOW), en segundo plano
  await flush();
  return s;
}
async function narrowed(replies: Reply[], opts: { timeoutMs?: number } = {}) {
  const s = await started([active(["kmp_time"]), ...replies], opts);
  await s.pi.fire("agent_start");
  assert.deepEqual(sorted(s.pi.active), NARROWED, "precondición: una decisión redujo las tools");
  return s;
}

test("active sin control aplica floor ∪ selected ∪ tools de Pi, dentro de la fase; control y shadow restauran el conjunto completo", async () => {
  const { pi, host, calls } = setup([active(["kmp_time", "made_get_help"]), active(["kmp_trace"], true), active(["kmp_trace"]), { mode: "shadow", control: false, selected: ["kmp_time"], floor: [] }]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.DESIGN);
  await flush();
  assert.deepEqual(calls.map((c) => [c.session, c.phase]), [["s1", "design"]], "el cambio de fase decide");
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
  await flush();
  assert.deepEqual(calls.map((c) => c.phase), ["interactive", "interactive"], "la primera emisión y la de fase desconocida; la repetida no");
});

test("el select lleva el plazo absoluto (ahora + tope) para que el host no registre lo que Pi ya no aplicará", async () => {
  const { calls, pi, host } = setup([], { timeoutMs: 200 });
  await pi.fire("session_start");
  const t0 = Date.now();
  await host.learn(pi as never);
  const t1 = Date.now();
  const deadline = calls[0].deadline!.epochMs();
  assert.ok(deadline >= t0 + 200 && deadline <= t1 + 200, `${t0} ${deadline} ${t1}`);
});

test("plazo agotado: Pi no espera a la respuesta lenta, sigue con el conjunto completo y la respuesta tardía se ignora", async () => {
  const slow = new Deferred<SelectionDto>();
  const { pi, host } = await started([slow], { timeoutMs: SHORT });
  const before = sorted(pi.active); const sets = pi.sets;
  const t0 = Date.now();
  await host.learn(pi as never);
  assert.ok(Date.now() - t0 < LENIENT_MS);
  slow.resolve(active(["kmp_time"])); // llega después de que learn volviera
  await flush();
  assert.deepEqual(sorted(pi.active), before);
  assert.equal(pi.sets, sets);
});

test("si conectar con el host agota el plazo, select ni se envía: ninguna decisión queda registrada", async () => {
  const pi = new FakePi(); let selects = 0; const connecting = new Deferred<void>();
  const gateway = { select: async () => { selects++; return SHADOW; }, onClose: () => {}, close: () => {} };
  const host = new HostExtension(async () => { await connecting.promise; return gateway as never; }, new SelectPhaseTools(PhaseToolSelection.standard()), SHORT);
  host.register(pi as never);
  const starting = pi.fire("session_start");
  await host.learn(pi as never); // vuelve por el plazo, con la conexión aún pendiente
  connecting.resolve();
  await starting; await flush();
  assert.equal(selects, 0);
});

test("un error o el host caído dejan el conjunto completo, también tras una decisión que redujo", async () => {
  const { pi } = await narrowed([new Error("boom")]);
  await pi.fire("agent_start");
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE);
  const down = setup([]);
  down.state.down = true;
  await down.pi.fire("session_start");
  assert.equal(down.pi.notices.length, 1, "el aviso va a la UI, no a la consola del test");
  down.host.applyPhase(down.pi as never, Phase.INTERACTIVE);
  await down.pi.fire("agent_start");
  assert.deepEqual(sorted(down.pi.active), FULL_INTERACTIVE);
  assert.equal(down.calls.length, 0);
});

test("una respuesta que llega tras cambiar de fase o de sesión no se aplica", async () => {
  const slow = new Deferred<SelectionDto>();
  const { pi, host } = setup([slow]);
  await pi.fire("session_start");
  const pending = host.learn(pi as never);
  host.applyPhase(pi as never, Phase.DESIGN);
  slow.resolve(active(["kmp_time"]));
  await pending;
  assert.ok(pi.active.includes("made_design_ceremony"));
  await pi.fire("session_shutdown");
  assert.equal(await host.learn(pi as never), undefined);
});

test("respuestas desordenadas: sólo se aplica la de la última decisión pedida", async () => {
  const first = new Deferred<SelectionDto>(); const second = new Deferred<SelectionDto>();
  const { pi, host } = await started([first, second]);
  const a = host.learn(pi as never); const b = host.learn(pi as never);
  second.resolve(active(["kmp_time"]));
  await b;
  assert.deepEqual(sorted(pi.active), NARROWED);
  first.resolve(active(["kmp_trace"]));
  await a;
  assert.deepEqual(sorted(pi.active), NARROWED, "la respuesta vieja no pisa a la nueva");
});

test("una sesión nueva no hereda la reducción de la anterior: se restaura el conjunto completo", async () => {
  for (const next of ["shadow", "timeout", "down"] as const) {
    const slow = new Deferred<SelectionDto>();
    const s = await narrowed(next === "timeout" ? [slow] : [], { timeoutMs: next === "timeout" ? SHORT : LONG });
    await s.pi.fire("session_shutdown");
    if (next === "down") s.state.down = true;
    s.pi.sid = "s2";
    await s.pi.fire("session_start");
    assert.deepEqual(sorted(s.pi.active), FULL_INTERACTIVE, `${next}: al empezar la sesión`);
    await s.pi.fire("agent_start");
    assert.deepEqual(sorted(s.pi.active), FULL_INTERACTIVE, `${next}: tras la decisión de la sesión nueva`);
    slow.resolve(active(["kmp_time"]));
    await flush();
    assert.deepEqual(sorted(s.pi.active), FULL_INTERACTIVE, next);
  }
});

// Casos de fallo tras una reducción (carry-over de Task 7): una negativa `ok:false` llega como
// HostCallError, que bajo Pi viene de otro realm de jiti; todos restauran el conjunto completo.
async function restoresAfter(failure: Reply, opts: { timeoutMs?: number } = {}) {
  const { pi } = await narrowed([failure], opts);
  await assert.doesNotReject(pi.fire("agent_start"));
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE);
  return pi;
}

test("una negativa del host (ok:false → HostCallError de otro realm) restaura el conjunto completo sin lanzar", async () => {
  const url = pathToFileURL(new URL("../../../../../src/application/ports/HostCallError.ts", import.meta.url).pathname).href;
  const foreign = (await import(`${url}?realm=host`)).HostCallError as typeof HostCallError;
  await restoresAfter(new foreign("invalid", "unknown session", "bad_request"));
});

test("un gateway que lanza en síncrono al llamar a select restaura el conjunto completo sin lanzar", async () => {
  const s = await narrowed([]);
  s.gateway.select = () => { throw new Error("sync boom"); };
  await assert.doesNotReject(s.pi.fire("agent_start"));
  assert.deepEqual(sorted(s.pi.active), FULL_INTERACTIVE);
});

test("el plazo agotado tras una decisión que redujo restaura el conjunto completo", async () => {
  const slow = new Deferred<SelectionDto>();
  const pi = await restoresAfter(slow, { timeoutMs: SHORT });
  slow.resolve(active(["kmp_time"]));
  await flush();
  assert.deepEqual(sorted(pi.active), FULL_INTERACTIVE, "la respuesta tardía no vuelve a reducir");
});

test("sin gateway (host caído tras reducir y reconexión fallida) restaura el conjunto completo", async () => {
  const s = await narrowed([]);
  s.state.down = true; s.state.closed!();
  await assert.doesNotReject(s.pi.fire("agent_start"));
  assert.deepEqual(sorted(s.pi.active), FULL_INTERACTIVE);
});

test("una respuesta active malformada tras una reducción restaura el conjunto completo", async () => {
  for (const bad of [{ mode: "active", control: false, selected: null, floor: null }, { mode: "active", control: false, selected: [1], floor: [] }, null]) {
    await restoresAfter(() => bad as unknown as SelectionDto);
  }
});

test("un setActiveTools que lanza no rompe Pi", async () => {
  const { pi } = await started([active(["kmp_time"]), SHADOW]);
  pi.setActiveTools = () => { throw new Error("pi refused"); };
  await assert.doesNotReject(pi.fire("agent_start"));
  await assert.doesNotReject(pi.fire("agent_start"));
});

test("fases iguales de realms distintos (Phase de otra copia del módulo) no descartan la decisión", async () => {
  const url = pathToFileURL(new URL("../../../../../src/domain/session/Phase.ts", import.meta.url).pathname).href;
  const ForeignPhase = (await import(`${url}?realm=kmp`)).Phase as typeof Phase;
  assert.notEqual(ForeignPhase, Phase);
  const slow = new Deferred<SelectionDto>();
  const { pi, host } = setup([slow]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, ForeignPhase.INTERACTIVE); // decide en segundo plano
  host.applyPhase(pi as never, Phase.INTERACTIVE); // el otro servidor: misma fase, no decide otra vez
  slow.resolve(active(["kmp_time"]));
  await flush();
  assert.deepEqual(sorted(pi.active), NARROWED);
});

test("/underpass-status añade la línea learning con modo, seleccionadas/candidatas y miss", async () => {
  const pi = new FakePi(); const notes: string[] = [];
  const commands = new Map<string, { handler: (a: string, ctx: unknown) => Promise<void> }>();
  pi.registerCommand = ((n: string, o: { handler: (a: string, ctx: unknown) => Promise<void> }) => { commands.set(n, o); }) as never;
  const gateway = {
    health: async () => ({ project: "/repo", started: [] }),
    summary: async () => ({ summary: null, logPosition: 3, sessionChainIntact: true, learning: { mode: "shadow", selected: 12, candidates: 18, missRate: 0.042 } }),
    select: async () => SHADOW, onClose: () => {}, close: () => {},
  };
  const host = new HostExtension(async () => gateway as never, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  await pi.fire("session_start");
  await commands.get("underpass-status")!.handler("", { ...pi.ctx, ui: { notify: (m: string) => notes.push(m) } });
  assert.match(notes[0], /\nlearning: shadow · 12\/18 tools · miss 4%$/);
  gateway.summary = async () => ({ summary: null, logPosition: 3, sessionChainIntact: true, learning: { mode: "active", selected: null, candidates: null, missRate: null } });
  await commands.get("underpass-status")!.handler("", { ...pi.ctx, ui: { notify: (m: string) => notes.push(m) } });
  assert.match(notes[1], /\nlearning: active · -\/- tools · miss -$/);
});

// Ruling R7: el select lleva las tools nuestras que Pi tiene registradas, y un servidor que
// registra tarde (misma fase, conjunto distinto) provoca una decisión nueva sobre el conjunto real.
test("registro tardío de un servidor: el select lleva las tools registradas y se vuelve a decidir en la misma fase", async () => {
  const { pi, host, calls } = setup([active(["kmp_time"]), active(["kmp_time", "made_get_help"])]);
  pi.ours = OURS.filter((n) => n.startsWith("kmp_"));
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE); // KMP registró
  await flush();
  assert.deepEqual(sorted(pi.active), NARROWED);
  assert.deepEqual(calls[0].registered, ["kmp_ask", "kmp_wake", "kmp_time", "kmp_trace", "kmp_guide"]);
  pi.ours = [...OURS]; // MADE registra después
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await flush();
  assert.equal(calls.length, 2, "el conjunto registrado cambió: decisión nueva");
  assert.deepEqual(calls[1].registered, OURS);
  assert.deepEqual(sorted(pi.active), NARROWED, "la nueva decisión vuelve a reducir sobre el conjunto real");
  host.applyPhase(pi as never, Phase.INTERACTIVE); // mismo conjunto, pero la reducción se perdió
  await flush();
  assert.equal(calls.length, 3, "/underpass-phase a la misma fase tras reducir vuelve a decidir");
});

test("la misma fase con el mismo conjunto registrado y sin reducción no decide otra vez", async () => {
  const { pi, host, calls } = setup([]);
  await pi.fire("session_start");
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  host.applyPhase(pi as never, Phase.INTERACTIVE);
  await flush();
  assert.equal(calls.length, 1);
  await pi.fire("agent_start");
  assert.deepEqual(calls[1].registered, OURS, "agent_start también manda las registradas");
});

test("si Pi no deja leer sus tools registradas, el select va sin el campo y el host no filtra", async () => {
  const { pi, host, calls } = setup([]);
  await pi.fire("session_start");
  pi.ours = ["kmp_Bad Name"];
  await host.learn(pi as never);
  assert.equal(calls[0].registered, undefined);
});
