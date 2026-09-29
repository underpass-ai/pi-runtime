#!/usr/bin/env node
// Uso: node tests/acceptance/made-run-session.ts <proyecto> [ceremony_id=pi-runtime-run-smoke-1]
//
// Aceptación de F3: una sesión real de Pi por el SDK, con el modelo sustituido por el proveedor
// `faux` de pi-ai (sin red), las extensiones de ESTE checkout y el host real del proyecto con
// made-mcp real. Debe correr con XDG_STATE_HOME, MADE_SETUP_CONFIG_ROOT y KMP_MCP_DATA_DIR
// temporales (store y configuración de MADE sembrados con made-config.ts):
//  1. /underpass-phase design: el modelo faux diseña y publica pi_runtime_run_smoke (dos pasos
//     host_callback); la TUI acepta la publicación (S3a);
//  2. /underpass-phase run: el modelo arranca la publicada y, leyendo cada instancia que devuelve
//     MADE, reclama y completa cada paso y aplica cada transición habilitada hasta el terminal;
//     la TUI acepta, y se cuenta cuántas veces se pregunta en run (debe ser una: el arranque);
//  3. /underpass-status por el comando registrado (línea made: y la instancia);
//  4. cierre como AgentSessionRuntime.dispose() (el host revoca los grants de la sesión).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

for (const v of ["XDG_STATE_HOME", "MADE_SETUP_CONFIG_ROOT", "KMP_MCP_DATA_DIR"]) {
  if (!process.env[v]) { console.error(`set ${v} to a throwaway directory: this acceptance never touches the real stores`); process.exit(2); }
}
const prefix = process.env.PI_RUNTIME_PREFIX ?? join(process.env.HOME!, ".local/share/pi-runtime/pi-0.87.1");
const pkgDir = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
const main = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = typeof main.exports === "string" ? main.exports : main.exports?.["."]?.import ?? main.exports?.["."]?.default ?? main.main;
const sdk = await import(pathToFileURL(join(pkgDir, entry)).href);
const ai = await import(pathToFileURL(join(pkgDir, "node_modules/@earendil-works/pi-ai/dist/compat.js")).href);
const root = new URL("../../", import.meta.url).pathname;
const cwd = process.argv[2] ?? process.cwd();
const name = "pi_runtime_run_smoke";
const ceremonyId = process.argv[3] ?? "pi-runtime-run-smoke-1";

const DESIGN = {
  name, objective: "Smoke-test running a published ceremony from Pi.", required_inputs: ["brief"], outputs: ["verdict"], participants: [{ role_id: "REVIEWER" }],
  stages: [{ id: "draft", owner_role_id: "REVIEWER", instructions: "Draft a verdict on the brief." }, { id: "review", owner_role_id: "REVIEWER", instructions: "Confirm the verdict." }],
};
type Instance = { lifecycle?: string; end_reason?: string | null; claimable_step_ids?: string[]; claim_fence?: string; transitions?: { trigger: string; enabled: boolean }[] };
type Result = { role: string; toolName?: string; isError?: boolean; details?: { definition_yaml?: string } & Instance; content?: { type: string; text?: string }[] };
const results = (context: { messages: Result[] }) => context.messages.filter((m) => m.role === "toolResult");
const yaml = (context: { messages: Result[] }) => results(context).find((m) => m.toolName === "made_design_ceremony")?.details?.definition_yaml ?? "";
const call = (tool: string, args: (c: { messages: Result[] }) => Record<string, unknown>, id: string) =>
  (c: { messages: Result[] }) => ai.fauxAssistantMessage(ai.fauxToolCall(tool, args(c), { id }), { stopReason: "toolUse" });
let outcomes: { tool: string; error: boolean; head: string }[] = [];
const snapshot = (c: { messages: Result[] }) => { outcomes = results(c).map((m) => ({ tool: m.toolName ?? "?", error: m.isError === true, head: (m.content ?? []).map((x) => x.text ?? "").join("").slice(0, 160) })); };
let n = 0;
// El agente de la fase run: decide el siguiente paso leyendo la última instancia que devolvió MADE.
const runner = (c: { messages: Result[] }) => {
  const last = results(c).at(-1);
  const id = `f3r${++n}`;
  if (last === undefined || last.isError === true || last.toolName === undefined || !last.toolName.startsWith("made_")) { snapshot(c); return ai.fauxAssistantMessage("stopped"); }
  const inst = last.details ?? {};
  if (last.toolName === "made_claim_ceremony_step") {
    const step = claimedStep;
    return ai.fauxAssistantMessage(ai.fauxToolCall("made_complete_ceremony_step", { ceremony_id: ceremonyId, step_id: step, actor_kind: "agent", status: "completed", claim_fence: inst.claim_fence,
      output: { verdict: { ok: true, step, by: "pi faux agent" } } }, { id }), { stopReason: "toolUse" });
  }
  if (inst.lifecycle === "ended") { snapshot(c); lastText = `ceremony ${ceremonyId} ended: ${inst.end_reason}`; return ai.fauxAssistantMessage(lastText); }
  const step = inst.claimable_step_ids?.[0];
  if (step !== undefined) { claimedStep = step; return ai.fauxAssistantMessage(ai.fauxToolCall("made_claim_ceremony_step", { ceremony_id: ceremonyId, step_id: step, actor_kind: "agent" }, { id }), { stopReason: "toolUse" }); }
  const enabled = inst.transitions?.find((x) => x.enabled);
  if (enabled === undefined) { snapshot(c); return ai.fauxAssistantMessage("no step or transition available"); }
  return ai.fauxAssistantMessage(ai.fauxToolCall("made_apply_ceremony_transition", { ceremony_id: ceremonyId, trigger: enabled.trigger, actor_kind: "agent" }, { id }), { stopReason: "toolUse" });
};
let claimedStep = ""; let lastText = "";

const faux = ai.fauxProvider({ provider: "f3-faux", models: [{ id: "f3-faux-model" }] });
const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd, agentDir: sdk.getAgentDir(), settingsManager, noExtensions: true,
  additionalExtensionPaths: ["host", "kmp", "made"].map((e) => join(root, "src/adapters/inbound/pi/entry", `${e}.ts`)),
});
await resourceLoader.reload();
const loaded = resourceLoader.getExtensions();
if (loaded.errors.length) { console.error(loaded.errors); process.exit(1); }
const { session } = await sdk.createAgentSession({ cwd, resourceLoader, settingsManager, model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(cwd) });
session.modelRuntime.registerNativeProvider(faux.provider);
await session.modelRuntime.setRuntimeApiKey("f3-faux", "faux");
const notes: string[] = []; const asked: string[] = [];
const noop = () => undefined;
const uiContext: Record<string, unknown> = Object.fromEntries(["addAutocompleteProvider", "custom", "editor", "getEditorText", "input", "onTerminalInput", "pasteToEditor", "select", "setEditorText", "setFooter", "setHeader", "setHiddenThinkingLabel", "setStatus", "setTitle", "setWidget", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"].map((key) => [key, noop]));
uiContext.notify = (m: string) => { notes.push(String(m)); };
uiContext.confirm = async (title: string, message: string) => { asked.push(`${title} | ${message}`); return true; };
const extensionErrors: string[] = [];
await session.bindExtensions({ uiContext, onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !session.getAllTools().some((t: { name: string }) => t.name === "made_publish_ceremony_definition")) await new Promise((r) => setTimeout(r, 200));
// Las tools de administración de la autorización (never) no llegan a Pi: ni registradas ni activas.
const NEVER = ["made_issue_authorization_grant", "made_revoke_authorization_grant", "made_approve_authorization_operation", "made_get_authorization_policy", "made_list_authorization_decisions"];
const adminTools = session.getAllTools().map((t: { name: string }) => t.name).filter((n: string) => NEVER.includes(n));

await session.prompt("/underpass-phase design");
faux.setResponses([
  call("made_design_ceremony", () => DESIGN, "f3d1"),
  call("made_publish_ceremony_definition", (c) => ({ definition_yaml: yaml(c) }), "f3d2"),
  (c: { messages: Result[] }) => { snapshot(c); return ai.fauxAssistantMessage("published"); },
]);
await session.prompt(`design and publish ${name}`);
const designOutcomes = outcomes;
const askedInDesign = asked.length;

await session.prompt("/underpass-phase run");
const runTools = session.getActiveToolNames().filter((t: string) => t.startsWith("made_")).sort();
faux.setResponses([
  call("made_start_published_ceremony", () => ({ ceremony: name, version: "1.0", ceremony_id: ceremonyId, actor_id: "pi:f3-acceptance", actor_kind: "agent", context: { brief: "F3 acceptance" } }), "f3s"),
  ...Array.from({ length: 16 }, () => runner),
]);
await session.prompt(`run ${name} to its end`);
const askedInRun = asked.slice(askedInDesign);
await session.prompt("/underpass-status");
const sid = session.sessionManager.getSessionId();
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();

const statusLines = notes.join("\n").split("\n");
const made = statusLines.find((l) => l.startsWith("made: ")) ?? null;
const ceremonyLine = statusLines.find((l) => l.includes(`ceremony ${ceremonyId}`)) ?? null;
const tools = outcomes.map((o) => `${o.tool}:${o.error ? `error ${o.head}` : "ok"}`);
const checks = {
  published: designOutcomes.some((o) => o.tool === "made_publish_ceremony_definition" && !o.error),
  runPhaseTools: JSON.stringify(runTools) === JSON.stringify(["made_apply_ceremony_transition", "made_claim_ceremony_step", "made_complete_ceremony_step", "made_design_ceremony",
    "made_diff_ceremony_definitions", "made_explain_ceremony_draft", "made_get_ceremony_instance", "made_get_help", "made_list_contracts", "made_publish_ceremony_definition",
    "made_start_published_ceremony", "made_validate_ceremony_draft"]),
  askedOnceInRun: askedInRun.length === 1 && askedInRun[0].startsWith(`MADE: start_published_ceremony | Ceremony "${ceremonyId}"`),
  reachedTerminal: outcomes.every((o) => !o.error) && outcomes.some((o) => o.tool === "made_apply_ceremony_transition") && /ended: completed/.test(String(lastText)),
  statusMadeLine: made !== null && ceremonyLine !== null,
  noExtensionErrors: extensionErrors.length === 0,
  noAdminTools: adminTools.length === 0,
};
console.log(JSON.stringify({ sessionId: sid, askedInDesign: asked.slice(0, askedInDesign), askedInRun, runTools, tools, made, ceremonyLine, extensionErrors, adminTools, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
