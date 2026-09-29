import { test } from "node:test";
import assert from "node:assert/strict";
import { HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { PiEventFactMapper } from "../../../../../src/adapters/inbound/pi/PiEventFactMapper.ts";
import { PiToolFactory } from "../../../../../src/adapters/inbound/pi/PiToolFactory.ts";
import type { CallContextDto } from "../../../../../src/application/dto/CallContextDto.ts";
import { McpToolMapper } from "../../../../../src/application/mappers/McpToolMapper.ts";
import { HostCallError } from "../../../../../src/application/ports/HostCallError.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";
import { Phase } from "../../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";

const REQUEST = { token: "ab".repeat(16), action: "publish_ceremony_definition", scopeSummary: "definition d v1.0" };
const CONTEXT: CallContextDto = { sessionId: "s1", phase: "design" };
const needs = () => new HostCallError("refused", "publish_ceremony_definition on definition d v1.0 needs human confirmation", "needs_confirmation", REQUEST);

// Un host que pide confirmación a la primera y, con el token, responde lo que diga `retry`.
function hostFake(retry: () => Promise<unknown> = async () => ({ structured: { published: true }, text: "published" })) {
  const calls: (CallContextDto | undefined)[] = []; const told: string[] = [];
  const gateway = {
    call: async (_s: ServerName, _t: unknown, _a: unknown, context?: CallContextDto) => { calls.push(context); if (context?.confirmation === undefined) throw needs(); return retry(); },
    confirmation: async (id: { value: string }, token: string, outcome: string) => { told.push(`${id.value} ${token} ${outcome}`); return { recorded: true }; },
  };
  return { calls, told, gateway: async () => gateway as never };
}
const publish = (host: ReturnType<typeof hostFake>, context: () => CallContextDto | null = () => CONTEXT) =>
  new PiToolFactory((j) => j).create(ServerName.MADE, new McpToolMapper().toDomain({ name: "made_publish_ceremony_definition", inputSchema: { type: "object" } }), host.gateway, context);
const ui = (answer: boolean | Error) => {
  const asked: string[] = [];
  return { asked, ctx: { hasUI: true, ui: { confirm: async (title: string, message: string) => { asked.push(`${title} | ${message}`); if (answer instanceof Error) throw answer; return answer; } } } };
};
const refusalCode = (e: Error) => PiEventFactMapper.outcomeOf(true, { content: [{ type: "text", text: e.message }] }, "made_publish_ceremony_definition");

test("aceptada: pregunta una vez con acción y alcance, repite con el token y devuelve el resultado", async () => {
  const host = hostFake(); const u = ui(true);
  const r = await publish(host).execute("c", { definition_yaml: "x" }, undefined, undefined, u.ctx);
  assert.deepEqual(r, { content: [{ type: "text", text: "published" }], details: { published: true } });
  assert.deepEqual(u.asked, ["MADE: publish_ceremony_definition | definition d v1.0. Allow this call?"]);
  assert.deepEqual(host.calls, [CONTEXT, { ...CONTEXT, confirmation: REQUEST.token }]);
  assert.deepEqual(host.told, []);
});

test("rechazada (o un diálogo que falla): negativa needs_confirmation_declined y el host lo registra", async () => {
  for (const answer of [false, new Error("dialog closed")]) {
    const host = hostFake(); const u = ui(answer);
    await assert.rejects(publish(host).execute("c", {}, undefined, undefined, u.ctx), (e: Error) => {
      assert.equal(e.message, "made_publish_ceremony_definition refused (needs_confirmation_declined): the user declined MADE publish_ceremony_definition on definition d v1.0");
      assert.deepEqual(refusalCode(e), { status: "refused", errorKind: "refused", errorCode: "needs_confirmation_declined" });
      return true;
    });
    assert.deepEqual(host.told, [`s1 ${REQUEST.token} declined`]);
    assert.equal(host.calls.length, 1, "sin token no hay segunda llamada");
  }
});

test("sin UI (pi -p): no pregunta, negativa needs_confirmation_no_ui y el host lo registra", async () => {
  for (const ctx of [{ hasUI: false, ui: ui(true).ctx.ui }, undefined]) {
    const host = hostFake();
    await assert.rejects(publish(host).execute("c", {}, undefined, undefined, ctx), (e: Error) => refusalCode(e).errorCode === "needs_confirmation_no_ui" && /has no UI/.test(e.message));
    assert.deepEqual(host.told, [`s1 ${REQUEST.token} no_ui`]);
  }
});

test("nunca se pregunta dos veces por la misma llamada: si el host vuelve a pedirla, es la respuesta", async () => {
  const host = hostFake(async () => { throw needs(); }); const u = ui(true);
  await assert.rejects(publish(host).execute("c", {}, undefined, undefined, u.ctx), (e: Error) => refusalCode(e).errorCode === "needs_confirmation");
  assert.equal(u.asked.length, 1);
});

test("sin contexto de sesión (host o extensión anterior) no se pregunta nada; un aviso al host que falla no cambia la negativa", async () => {
  const host = hostFake(); const u = ui(true);
  await assert.rejects(publish(host, () => null).execute("c", {}, undefined, undefined, u.ctx), (e: Error) => refusalCode(e).errorCode === "needs_confirmation");
  assert.deepEqual(u.asked, []);
  assert.deepEqual(host.calls, [undefined]);
  const broken = hostFake();
  const gw = await broken.gateway() as unknown as { confirmation: () => Promise<never> };
  gw.confirmation = async () => { throw new Error("host down"); };
  await assert.rejects(publish(broken).execute("c", {}, undefined, undefined, ui(false).ctx), /needs_confirmation_declined/);
});

test("callContext: null sin sesión; la sesión y la fase en curso después", async () => {
  const host = new HostExtension(async () => { throw new Error("no host"); }, new SelectPhaseTools(PhaseToolSelection.standard()));
  assert.equal(host.callContext(), null);
  const handlers = new Map<string, (e: unknown, ctx: unknown) => Promise<unknown>>();
  const pi = {
    on: (ev: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(ev, h), registerCommand: () => {}, registerTool: () => {},
    getAllTools: () => [], getActiveTools: () => [], setActiveTools: () => {}, events: { on: () => {}, emit: () => {} },
  };
  host.register(pi as never);
  await handlers.get("session_start")!({}, { cwd: "/repo", hasUI: true, ui: { notify: () => {} }, sessionManager: { getSessionId: () => "s9" } });
  assert.deepEqual(host.callContext(), { sessionId: "s9", phase: "interactive" });
  host.applyPhase(pi as never, Phase.DESIGN);
  assert.deepEqual(host.callContext(), { sessionId: "s9", phase: "design" });
  await handlers.get("session_shutdown")!({}, {});
  assert.equal(host.callContext(), null);
});

test("un abort durante el diálogo no es un rechazo: no se avisa al host y el error es el del abort", async () => {
  const host = hostFake(); const ac = new AbortController(); let seen: AbortSignal | undefined;
  const ctx = { hasUI: true, ui: { confirm: (_t: string, _m: string, opts?: { signal?: AbortSignal }) => new Promise<boolean>((resolve) => {
    seen = opts?.signal; opts?.signal?.addEventListener("abort", () => resolve(false), { once: true }); queueMicrotask(() => ac.abort());
  }) } };
  await assert.rejects(publish(host).execute("c", {}, ac.signal, undefined, ctx), (e: Error) => e.message === "made_publish_ceremony_definition aborted; outcome unknown");
  assert.equal(seen, ac.signal, "la señal de la llamada llega a ctx.ui.confirm");
  assert.deepEqual(host.told, []);
  assert.equal(host.calls.length, 1);
});

test("un abort entre la aceptación y el reenvío no envía la llamada con el token", async () => {
  const host = hostFake(); const ac = new AbortController();
  const ctx = { hasUI: true, ui: { confirm: async () => { ac.abort(); return true; } } };
  await assert.rejects(publish(host).execute("c", {}, ac.signal, undefined, ctx), /aborted; outcome unknown/);
  assert.equal(host.calls.length, 1, "el token no se consume");
  assert.deepEqual(host.told, []);
});

test("abortable detecta una señal ya abortada cuando empieza a esperar al host", async () => {
  const ac = new AbortController();
  const gateway = async () => { ac.abort(); return { call: async () => ({ structured: {}, text: "late" }) } as never; };
  const tool = new PiToolFactory((j) => j).create(ServerName.MADE, new McpToolMapper().toDomain({ name: "made_list_contracts", inputSchema: { type: "object" } }), gateway);
  await assert.rejects(tool.execute("c", {}, ac.signal), /made_list_contracts aborted; outcome unknown/);
});
