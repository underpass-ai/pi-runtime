import { test } from "node:test";
import assert from "node:assert/strict";
import { HOST_READY, HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { ServerToolsExtension } from "../../../../../src/adapters/inbound/pi/ServerToolsExtension.ts";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnixSocketHostServer } from "../../../../../src/adapters/inbound/ipc/UnixSocketHostServer.ts";
import { UnixSocketHostGateway } from "../../../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { ToolName } from "../../../../../src/domain/mcp/ToolName.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import { McpToolMapper } from "../../../../../src/application/mappers/McpToolMapper.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";
import { ServerIdentity } from "../../../../../src/domain/mcp/ServerIdentity.ts";
import { ToolCatalog } from "../../../../../src/domain/mcp/ToolCatalog.ts";
import { SemVer } from "../../../../../src/domain/distribution/SemVer.ts";

class FakePi {
  handlers = new Map<string, ((e: unknown, ctx: unknown) => unknown)[]>();
  bus = new Map<string, ((d: unknown) => unknown)[]>();
  tools: { name: string; execute: Function }[] = [];
  active = ["read", "bash"];
  commands = new Map<string, { handler: (a: string, ctx: unknown) => Promise<void> }>();
  notes: string[] = [];
  on(ev: string, h: (e: unknown, ctx: unknown) => unknown) { (this.handlers.get(ev) ?? this.handlers.set(ev, []).get(ev)!).push(h); }
  registerTool(t: { name: string; execute: Function }) { this.tools.push(t); }
  registerCommand(n: string, o: { handler: (a: string, ctx: unknown) => Promise<void> }) { this.commands.set(n, o); }
  getAllTools() { return [...["read", "bash"].map((name) => ({ name })), ...this.tools.map((t) => ({ name: t.name }))]; }
  getActiveTools() { return [...this.active]; }
  setActiveTools(n: string[]) { this.active = n; }
  events = { on: (ev: string, h: (d: unknown) => unknown) => { (this.bus.get(ev) ?? this.bus.set(ev, []).get(ev)!).push(h); }, emit: (ev: string, d: unknown) => { for (const h of this.bus.get(ev) ?? []) h(d); } };
  ctx = { cwd: "/repo", hasUI: true, ui: { notify: (m: string) => { this.notes.push(m); } } };
  async fire(ev: string) { for (const h of this.handlers.get(ev) ?? []) await h({}, this.ctx); await new Promise((r) => setTimeout(r, 20)); } // deja terminar los handlers asíncronos del bus
}

const catalog = (server: ServerName, names: string[]) => ToolCatalog.of(server, ServerIdentity.of("s", SemVer.of("1.0.0")), names.map((n) => new McpToolMapper().toDomain({ name: n, inputSchema: { type: "object" } })));

function gatewayFake(closed: { v: boolean }) {
  return {
    catalog: async (s: ServerName) => catalog(s, s.equals(ServerName.KMP) ? ["kmp_ask", "kmp_ingest"] : ["made_claim_ceremony_step", "made_design_ceremony"]),
    call: async (_s: ServerName, t: { value: string }) => { if (t.value === "kmp_ingest") throw new HostCallError("refused", "nope", "invalid_argument"); return { structured: { ok: 1 }, text: "x".repeat(20) }; },
    health: async () => ({ project: "/repo", started: ["kmp"] }),
    close: () => { closed.v = true; },
    onClose: () => {},
  };
}

test("session_start conecta, registra tools de ambos servidores y activa sólo las de la fase", async () => {
  const pi = new FakePi(); const closed = { v: false }; let connects = 0;
  const select = new SelectPhaseTools(PhaseToolSelection.standard());
  const host = new HostExtension(async () => { connects++; return gatewayFake(closed); }, select);
  const factory = new PiToolFactory((j) => ({ wrapped: j }), 10);
  host.register(pi as never);
  new ServerToolsExtension(ServerName.KMP, host, factory).register(pi as never);
  new ServerToolsExtension(ServerName.MADE, host, factory).register(pi as never);
  assert.equal(connects, 0); // la factoría no abre nada
  await pi.fire("session_start");
  assert.equal(connects, 1);
  assert.deepEqual(pi.tools.map((t) => t.name).sort(), ["kmp_ask", "kmp_ingest", "made_claim_ceremony_step", "made_design_ceremony"]);
  assert.deepEqual(pi.active.sort(), ["bash", "kmp_ask", "read"]);

  const ask = pi.tools.find((t) => t.name === "kmp_ask")!;
  const res = await ask.execute("c1", {});
  assert.match(res.content[0].text, /^x{10}\n\[truncated 10 chars/);
  assert.deepEqual(res.details, { ok: 1 });
  await assert.rejects(pi.tools.find((t) => t.name === "kmp_ingest")!.execute("c2", {}), /kmp_ingest refused \(invalid_argument\): nope/);

  await pi.commands.get("underpass-phase")!.handler("design", pi.ctx);
  assert.deepEqual(pi.active.sort(), ["bash", "kmp_ask", "made_design_ceremony", "read"]);
  await pi.commands.get("underpass-status")!.handler("", pi.ctx);
  assert.match(pi.notes.at(-1)!, /project: \/repo[\s\S]*kmp 1\.0\.0: 2 tools/);

  await pi.fire("session_shutdown");
  assert.equal(closed.v, true);
});

test("fallo de conexión se notifica y no rompe la sesión", async () => {
  const pi = new FakePi();
  const host = new HostExtension(async () => { throw new Error("no host"); }, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  await pi.fire("session_start");
  assert.match(pi.notes[0], /Underpass host unavailable: no host/);
});

test("fallo de conexión sin UI se registra en consola", async () => {
  const original = console.error;
  const logs: string[] = [];
  console.error = ((...args: unknown[]) => { logs.push(args.join(" ")); }) as typeof console.error;
  try {
    const pi = new FakePi();
    (pi as unknown as { ctx: unknown }).ctx = { cwd: "/repo", hasUI: false, ui: { notify: () => { throw new Error("no debería notificar sin UI"); } } };
    const host = new HostExtension(async () => { throw new Error("no host"); }, new SelectPhaseTools(PhaseToolSelection.standard()));
    host.register(pi as never);
    await pi.fire("session_start");
    assert.match(logs.join("\n"), /Underpass host unavailable: no host/);
  } finally {
    console.error = original;
  }
});

test("un catálogo que falla no registra tools, avisa por evento y consola, y se reintenta en el siguiente HOST_READY", async () => {
  const pi = new FakePi();
  let catalogCalls = 0;
  const gateway = {
    catalog: async (s: ServerName) => { catalogCalls++; if (catalogCalls === 1) throw new Error("catalog down"); return catalog(s, ["kmp_ask"]); },
    call: async () => ({ structured: null, text: "" }),
    health: async () => ({ project: "/repo", started: [] }),
    close: () => {},
    onClose: () => {},
  };
  const host = new HostExtension(async () => gateway, new SelectPhaseTools(PhaseToolSelection.standard()));
  const factory = new PiToolFactory((j) => j);
  host.register(pi as never);
  new ServerToolsExtension(ServerName.KMP, host, factory).register(pi as never);

  const failures: unknown[] = [];
  pi.events.on("underpass:catalog-failed", (d) => failures.push(d));
  const original = console.error;
  console.error = (() => {}) as typeof console.error;

  try {
    await pi.fire("session_start");
    assert.deepEqual(pi.tools, []);
    assert.deepEqual(failures, [{ server: "kmp", message: "catalog down" }]);

    await pi.fire("session_start");
    assert.deepEqual(pi.tools.map((t) => t.name), ["kmp_ask"]);
  } finally {
    console.error = original;
  }
});

test("dos HOST_READY concurrentes registran cada tool una sola vez", async () => {
  const pi = new FakePi();
  let catalogCalls = 0;
  const gateway = {
    catalog: async (s: ServerName) => { catalogCalls++; await new Promise((r) => setTimeout(r, 10)); return catalog(s, ["kmp_ask"]); },
    call: async () => ({ structured: null, text: "" }),
    health: async () => ({ project: "/repo", started: [] }),
    close: () => {},
    onClose: () => {},
  };
  const fakeHost = { gateway: async () => gateway, applyPhase: () => {} } as unknown as HostExtension;
  const factory = new PiToolFactory((j) => j);
  new ServerToolsExtension(ServerName.KMP, fakeHost, factory).register(pi as never);

  pi.events.emit(HOST_READY, null);
  pi.events.emit(HOST_READY, null); // segundo HOST_READY antes de que el primer catalog() resuelva

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(catalogCalls, 1);
  assert.deepEqual(pi.tools.map((t) => t.name), ["kmp_ask"]);
});

test("dos session_start sin shutdown cierran el gateway anterior una sola vez", async () => {
  const pi = new FakePi();
  let closes1 = 0; let closes2 = 0; let calls = 0;
  const gw1 = { catalog: async () => catalog(ServerName.KMP, []), call: async () => ({ structured: null, text: "" }), health: async () => ({ project: "/repo", started: [] }), close: () => { closes1++; }, onClose: () => {} };
  const gw2 = { catalog: async () => catalog(ServerName.KMP, []), call: async () => ({ structured: null, text: "" }), health: async () => ({ project: "/repo", started: [] }), close: () => { closes2++; }, onClose: () => {} };
  const host = new HostExtension(async () => { calls++; return calls === 1 ? gw1 : gw2; }, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  await pi.fire("session_start");
  await pi.fire("session_start");
  assert.equal(closes1, 1);
  assert.equal(closes2, 0);
});

test("execute rechaza inmediatamente si la señal ya está abortada", async () => {
  const factory = new PiToolFactory((j) => j);
  const descriptor = new McpToolMapper().toDomain({ name: "kmp_ask", inputSchema: { type: "object" } });
  const tool = factory.create(ServerName.KMP, descriptor, async () => { throw new Error("no debería llamar a la gateway"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tool.execute("c", {}, controller.signal), /kmp_ask aborted; outcome unknown/);
});

test("execute rechaza si la señal se aborta mientras la llamada no resuelve", async () => {
  const factory = new PiToolFactory((j) => j);
  const descriptor = new McpToolMapper().toDomain({ name: "kmp_ask", inputSchema: { type: "object" } });
  const neverResolving = async () => ({
    catalog: async () => { throw new Error("n/a"); },
    call: () => new Promise<never>(() => {}),
    health: async () => ({ project: "", started: [] }),
    close: () => {},
    onClose: () => {},
  });
  const tool = factory.create(ServerName.KMP, descriptor, neverResolving);
  const controller = new AbortController();
  const pending = tool.execute("c", {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, /kmp_ask aborted; outcome unknown/);
});

test("el truncado no parte un par subrogado por la mitad", async () => {
  const text = "abcd😀efgh"; // "abcd" + 😀 (par subrogado) + "efgh"
  const gateway = async () => ({
    catalog: async () => { throw new Error("n/a"); },
    call: async () => ({ structured: null, text }),
    health: async () => ({ project: "", started: [] }),
    close: () => {},
    onClose: () => {},
  });
  const factory = new PiToolFactory((j) => j, 5);
  const descriptor = new McpToolMapper().toDomain({ name: "kmp_ask", inputSchema: { type: "object" } });
  const tool = factory.create(ServerName.KMP, descriptor, gateway);
  const res = await tool.execute("c", {});
  assert.equal(res.content[0].text, "abcd\n[truncated 6 chars; full result in details]");
});

test("si el host muere, la llamada en vuelo falla al momento y la siguiente reconecta (relanzando el host)", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "ipc-")), "host.sock");
  const handler = async (req: { id: number; method: string; args?: unknown }) => req.method === "call"
    ? { id: req.id, ok: true as const, result: { structured: req.args, text: "ok" } }
    : { id: req.id, ok: true as const, result: { project: "/repo", started: [] } };
  let server = await UnixSocketHostServer.start(path, () => new Promise(() => {})); // el primer host nunca responde
  let launches = 0;
  const connect = async () => {
    try { return await UnixSocketHostGateway.connect(path); }
    catch { launches++; server = await UnixSocketHostServer.start(path, handler as never); return UnixSocketHostGateway.connect(path); }
  };
  const pi = new FakePi();
  const host = new HostExtension(connect, new SelectPhaseTools(PhaseToolSelection.standard()));
  host.register(pi as never);
  try {
    await pi.fire("session_start");
    const inFlight = (await host.gateway()).call(ServerName.KMP, ToolName.of("kmp_ask"), { q: 1 });
    await server.close(); // muere el host
    await assert.rejects(inFlight, (e) => HostCallError.is(e) && e.kind === "transport");
    await new Promise((r) => setImmediate(r));
    const again = await host.gateway();
    assert.deepEqual(await again.call(ServerName.KMP, ToolName.of("kmp_ask"), { q: 2 }), { structured: { q: 2 }, text: "ok" });
    assert.equal(launches, 1);
  } finally {
    await pi.fire("session_shutdown");
    await server.close();
  }
});

test("una reconexión fallida no se queda cacheada: la siguiente llamada vuelve a intentarlo", async () => {
  let attempts = 0;
  let listener: (() => void) | null = null;
  const gw = { ...{ catalog: async () => catalog(ServerName.KMP, []), call: async () => ({ structured: null, text: "" }), health: async () => ({ project: "/repo", started: [] }), close: () => {} }, onClose: (l: () => void) => { listener = l; } };
  const host = new HostExtension(async () => { attempts++; if (attempts === 2) throw new Error("still down"); return gw; }, new SelectPhaseTools(PhaseToolSelection.standard()));
  const pi = new FakePi();
  host.register(pi as never);
  await assert.rejects(host.gateway(), /not connected yet/);
  await pi.fire("session_start");
  listener!(); // el host se cae
  await assert.rejects(host.gateway(), /still down/);
  assert.equal(await host.gateway(), gw);
  assert.equal(attempts, 3);
  await pi.fire("session_shutdown");
  await assert.rejects(host.gateway(), /not connected yet/);
});
