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
  made = undefined; // un host anterior a S3a
  await commands.get("underpass-status")!.handler("", ctx);
  assert.ok(!notes.at(-1)!.includes("made:"));
});
