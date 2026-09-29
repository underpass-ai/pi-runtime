#!/usr/bin/env node
// Uso: S3A_CONFIRM=accept|decline|noui node tests/acceptance/made-auth-session.ts <proyecto> [nombre=pr_review_two_reviewers]
//
// Aceptación de S3a (spec §7): una sesión real de Pi por el SDK, con el modelo sustituido por
// el proveedor `faux` de pi-ai (sin red), las extensiones de ESTE checkout y el host real del
// proyecto con made-mcp real. Debe correr con XDG_STATE_HOME, MADE_SETUP_CONFIG_ROOT y
// KMP_MCP_DATA_DIR temporales (store y configuración de MADE sembrados con made-config.ts):
//  1. /underpass-phase design;
//  2. una petición en la que el modelo faux diseña, valida y explica la definición, y la publica;
//  3. la confirmación de la TUI responde según S3A_CONFIRM (y se cuenta cuántas veces se pide);
//     con `noui` la sesión se ata sin uiContext (hasUI false) y publicar no puede preguntar;
//  4. /underpass-status por el comando registrado;
//  5. cierre como AgentSessionRuntime.dispose() (el host revoca los grants de la sesión).
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
const name = process.argv[3] ?? "pr_review_two_reviewers";
const mode = process.env.S3A_CONFIRM ?? "accept";
if (!["accept", "decline", "noui"].includes(mode)) { console.error("S3A_CONFIRM must be accept, decline or noui"); process.exit(2); }
const accept = mode === "accept";
const noUi = mode === "noui";

const DESIGN = {
  name, objective: "Review a pull request with two independent reviewers and agree on a verdict.", required_inputs: ["pull_request"], outputs: ["verdict"],
  participants: [{ role_id: "REVIEWER" }], stages: [{ id: "review", owner_role_id: "REVIEWER", instructions: "Review the change independently.", num_agents: 2 }],
};
type Result = { role: string; toolName?: string; isError?: boolean; details?: { definition_yaml?: string }; content?: { type: string; text?: string }[] };
const results = (context: { messages: Result[] }) => context.messages.filter((m) => m.role === "toolResult");
const yaml = (context: { messages: Result[] }) => results(context).find((m) => m.toolName === "made_design_ceremony")?.details?.definition_yaml ?? "";
const call = (tool: string, args: (c: { messages: Result[] }) => Record<string, unknown>, id: string) =>
  (c: { messages: Result[] }) => ai.fauxAssistantMessage(ai.fauxToolCall(tool, args(c), { id }), { stopReason: "toolUse" });
let outcomes: { tool: string; error: boolean; head: string }[] = [];

const faux = ai.fauxProvider({ provider: "s3a-faux", models: [{ id: "s3a-faux-model" }] });
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
await session.modelRuntime.setRuntimeApiKey("s3a-faux", "faux");
const notes: string[] = []; const asked: string[] = [];
const noop = () => undefined;
const uiContext: Record<string, unknown> = Object.fromEntries(["addAutocompleteProvider", "custom", "editor", "getEditorText", "input", "onTerminalInput", "pasteToEditor", "select", "setEditorText", "setFooter", "setHeader", "setHiddenThinkingLabel", "setStatus", "setTitle", "setWidget", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"].map((key) => [key, noop]));
uiContext.notify = (m: string) => { notes.push(String(m)); };
uiContext.confirm = async (title: string, message: string) => { asked.push(`${title} | ${message}`); return accept; };
const extensionErrors: string[] = [];
await session.bindExtensions({ ...(noUi ? {} : { uiContext }), onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !session.getAllTools().some((t: { name: string }) => t.name === "made_publish_ceremony_definition")) await new Promise((r) => setTimeout(r, 200));

await session.prompt("/underpass-phase design");
faux.setResponses([
  call("made_design_ceremony", () => DESIGN, "s3a1"),
  call("made_validate_ceremony_draft", (c) => ({ definition_yaml: yaml(c) }), "s3a2"),
  call("made_explain_ceremony_draft", (c) => ({ definition_yaml: yaml(c) }), "s3a3"),
  call("made_publish_ceremony_definition", (c) => ({ definition_yaml: yaml(c) }), "s3a4"),
  (c: { messages: Result[] }) => {
    outcomes = results(c).map((m) => ({ tool: m.toolName ?? "?", error: m.isError === true, head: (m.content ?? []).map((x) => x.text ?? "").join("").slice(0, 120) }));
    return ai.fauxAssistantMessage("done");
  },
]);
await session.prompt(`design, validate, explain and publish ${name}`);
await session.prompt("/underpass-status");
const sid = session.sessionManager.getSessionId();
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();

const by = (tool: string) => outcomes.find((o) => o.tool === tool);
const made = notes.join("\n").split("\n").find((l) => l.startsWith("made: ")) ?? null;
const publish = by("made_publish_ceremony_definition");
const checks = {
  designed: by("made_design_ceremony")?.error === false,
  validated: by("made_validate_ceremony_draft")?.error === false,
  explained: by("made_explain_ceremony_draft")?.error === false,
  askedOnce: noUi ? asked.length === 0 : asked.length === 1 && asked[0].startsWith("MADE: publish_ceremony_definition | definition "),
  publish: accept ? publish?.error === false : publish?.error === true && (noUi ? /needs_confirmation_no_ui/ : /needs_confirmation_declined/).test(publish.head),
  // Sin UI, /underpass-status no tiene dónde notificar: la línea sólo se comprueba con UI.
  statusMadeLine: noUi || made !== null,
  noExtensionErrors: extensionErrors.length === 0,
};
console.log(JSON.stringify({ sessionId: sid, confirm: mode, asked, outcomes, made, extensionErrors, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
