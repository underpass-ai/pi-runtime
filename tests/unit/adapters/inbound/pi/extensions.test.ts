import { test } from "node:test";
import assert from "node:assert/strict";
import { HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { ServerToolsExtension } from "../../../../../src/adapters/inbound/pi/ServerToolsExtension.ts";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import { HostCallError } from "../../../../../src/adapters/outbound/ipc/HostCallError.ts";
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
