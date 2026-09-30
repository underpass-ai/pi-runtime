#!/usr/bin/env node
// Uso: node tests/acceptance/made-read-definition-session.ts <proyecto> [ceremonia=pr_review_two_reviewers] [versión=1.0]
//
// Aceptación de made-mcp 0.9.0 en la fase run: una sesión real de Pi por el SDK, con el modelo
// sustituido por el proveedor `faux` de pi-ai (sin red), las extensiones de ESTE checkout y el host
// real del proyecto con made-mcp real, sobre el store de MADE que resuelva el entorno (una ceremonia
// ya publicada, que la sesión no diseñó). Debe correr con XDG_STATE_HOME y KMP_MCP_DATA_DIR
// temporales: el log de eventos y la memoria nunca son los reales.
//  1. /underpass-phase run: el modelo lista las publicadas y lee la definición pedida (sus pasos y
//     el prompt de cada uno), sin arrancar nada; ninguna pregunta en la TUI;
//  2. /underpass-status por el comando registrado;
//  3. cierre como AgentSessionRuntime.dispose() (el host revoca los grants de la sesión).
// Sólo imprime identidad y recuentos de la definición (pasos, prompts), nunca su contenido.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

for (const v of ["XDG_STATE_HOME", "KMP_MCP_DATA_DIR"]) {
  if (!process.env[v]) { console.error(`set ${v} to a throwaway directory: this acceptance never touches the real event log or memory`); process.exit(2); }
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
const version = process.argv[4] ?? "1.0";

type Result = { role: string; toolName?: string; isError?: boolean; details?: { definition_yaml?: string; ceremony?: string; version?: string; definitions?: { ceremony: string; version: string; step_count: number }[]; next_cursor?: string | null };
  content?: { type: string; text?: string }[] };
const results = (context: { messages: Result[] }) => context.messages.filter((m) => m.role === "toolResult");
const call = (tool: string, args: Record<string, unknown>, id: string) => () => ai.fauxAssistantMessage(ai.fauxToolCall(tool, args, { id }), { stopReason: "toolUse" });
let seen: Result[] = [];

const faux = ai.fauxProvider({ provider: "made090-faux", models: [{ id: "made090-faux-model" }] });
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
await session.modelRuntime.setRuntimeApiKey("made090-faux", "faux");
const notes: string[] = []; const asked: string[] = [];
const noop = () => undefined;
const uiContext: Record<string, unknown> = Object.fromEntries(["addAutocompleteProvider", "custom", "editor", "getEditorText", "input", "onTerminalInput", "pasteToEditor", "select", "setEditorText", "setFooter", "setHeader", "setHiddenThinkingLabel", "setStatus", "setTitle", "setWidget", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"].map((key) => [key, noop]));
uiContext.notify = (m: string) => { notes.push(String(m)); };
// Nada de esta sesión debe preguntar: si pregunta, se rechaza y el check lo cuenta.
uiContext.confirm = async (title: string, message: string) => { asked.push(`${title} | ${message}`); return false; };
const extensionErrors: string[] = [];
await session.bindExtensions({ uiContext, onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !session.getAllTools().some((t: { name: string }) => t.name === "made_get_ceremony_definition")) await new Promise((r) => setTimeout(r, 200));

await session.prompt("/underpass-phase run");
const runTools = session.getActiveToolNames().filter((t: string) => t.startsWith("made_")).sort();
faux.setResponses([
  call("made_list_ceremony_definitions", { limit: 100 }, "r1"),
  call("made_get_ceremony_definition", { ceremony: name, version }, "r2"),
  (c: { messages: Result[] }) => { seen = results(c); return ai.fauxAssistantMessage("read"); },
]);
await session.prompt(`list the published ceremonies and read ${name} ${version} before running it`);
await session.prompt("/underpass-status");
const sid = session.sessionManager.getSessionId();
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();

const listed = seen.find((m) => m.toolName === "made_list_ceremony_definitions");
const read = seen.find((m) => m.toolName === "made_get_ceremony_definition");
const yaml = read?.details?.definition_yaml ?? "";
const steps = (yaml.match(/^\s*- id: /gm) ?? []).length;
const prompts = (yaml.match(/^\s+prompt: /gm) ?? []).length;
const made = notes.join("\n").split("\n").find((l) => l.startsWith("made: ")) ?? null;
const checks = {
  runPhaseTools: runTools.includes("made_list_ceremony_definitions") && runTools.includes("made_get_ceremony_definition"),
  listed: listed?.isError !== true && (listed?.details?.definitions ?? []).some((d) => d.ceremony === name && d.version === version),
  read: read?.isError !== true && read?.details?.ceremony === name && read?.details?.version === version && prompts > 0,
  neverAsked: asked.length === 0,
  nothingStarted: seen.every((m) => m.toolName === "made_list_ceremony_definitions" || m.toolName === "made_get_ceremony_definition"),
  noExtensionErrors: extensionErrors.length === 0,
};
console.log(JSON.stringify({ sessionId: sid, runTools, tools: seen.map((m) => `${m.toolName}:${m.isError === true ? "error" : "ok"}`),
  definitions: listed?.details?.definitions?.length ?? null, nextCursor: listed?.details?.next_cursor ?? null, read: { ceremony: read?.details?.ceremony, version: read?.details?.version, yamlBytes: yaml.length, stateAndStepIds: steps, prompts },
  made, asked, extensionErrors, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
