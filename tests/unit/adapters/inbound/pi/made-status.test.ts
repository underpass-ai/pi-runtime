import { test } from "node:test";
import assert from "node:assert/strict";
import { HostExtension } from "../../../../../src/adapters/inbound/pi/HostExtension.ts";
import { SelectPhaseTools } from "../../../../../src/application/use-cases/SelectPhaseTools.ts";
import { PhaseToolSelection } from "../../../../../src/domain/session/PhaseToolSelection.ts";

test("/underpass-status añade la línea made con grants vigentes y confirmaciones (sólo si el host la envía)", async () => {
  let made: unknown = { activeGrants: 2, confirmations: 1 };
  const gateway = { health: async () => ({ project: "/repo", started: [] }), summary: async () => ({ summary: null, logPosition: 1, sessionChainIntact: true, made }), onClose: () => {}, close: () => {} };
  const host = new HostExtension(async () => gateway as never, new SelectPhaseTools(PhaseToolSelection.standard()));
  const handlers = new Map<string, (e: unknown, ctx: unknown) => Promise<unknown>>(); const commands = new Map<string, { handler: (a: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    on: (ev: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(ev, h), registerCommand: (n: string, o: { handler: (a: string, ctx: unknown) => Promise<void> }) => commands.set(n, o),
    registerTool: () => {}, getAllTools: () => [], getActiveTools: () => [], setActiveTools: () => {}, events: { on: () => {}, emit: () => {} },
  };
  host.register(pi as never);
  const notes: string[] = [];
  const ctx = { cwd: "/repo", hasUI: true, ui: { notify: (m: string) => notes.push(m) }, sessionManager: { getSessionId: () => "s1" } };
  await handlers.get("session_start")!({}, ctx);
  await commands.get("underpass-status")!.handler("", ctx);
  assert.equal(notes.at(-1)!.split("\n").at(-1), "made: 2 active grants · 1 confirmations");
  // F3: las instancias que arrancó la sesión, con sus grants vigentes o cómo terminaron.
  const grant = (action: string, state: string) => ({ grantId: `pi-runtime-${action}`, action, state, reason: state === "active" ? null : "ceremony_ended" });
  made = { activeGrants: 1, confirmations: 1, ceremonies: [
    { session: "s1", ceremonyId: "c1", summary: "ceremony c1 (smoke v1.0)", state: "running", endReason: null, startedAt: "x", grants: [grant("start_published_ceremony", "revoked"), grant("claim_ceremony_step", "active")] },
    { session: "s1", ceremonyId: "c0", summary: "ceremony c0", state: "ended", endReason: "completed", startedAt: "x", grants: [grant("claim_ceremony_step", "revoked")] },
  ] };
  await commands.get("underpass-status")!.handler("", ctx);
  assert.deepEqual(notes.at(-1)!.split("\n").slice(-3), ["made: 1 active grants · 1 confirmations", "  ceremony c1 (smoke v1.0): running · grants claim_ceremony_step",
    "  ceremony c0: ended (completed) · no active grants"]);
  await commands.get("underpass-phase")!.handler("run", ctx);
  assert.equal(notes.at(-1), "Underpass phase: run");
  const completions = (commands.get("underpass-phase") as unknown as { getArgumentCompletions: (p: string) => { value: string }[] }).getArgumentCompletions("r");
  assert.deepEqual(completions.map((c) => c.value), ["run"]);
  made = undefined; // un host anterior a S3a
  await commands.get("underpass-status")!.handler("", ctx);
  assert.ok(!notes.at(-1)!.includes("made:"));
});
