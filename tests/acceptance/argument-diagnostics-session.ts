#!/usr/bin/env node
// Uso: node tests/acceptance/argument-diagnostics-session.ts <proyecto>
//
// Aceptación de F1: una sesión real de Pi por el SDK, con el modelo sustituido por el proveedor
// `faux` de pi-ai (sin red), las extensiones de ESTE checkout y el host real del proyecto con
// made-mcp real. Como en S3a, debe correr con XDG_STATE_HOME, MADE_SETUP_CONFIG_ROOT y
// KMP_MCP_DATA_DIR temporales (store y configuración de MADE sembrados con made-config.ts):
//  1. /underpass-phase design;
//  2. el modelo faux llama a made_design_ceremony con el `repeat` de grupo escrito plano: el
//     resultado de error que ve el modelo es el diagnóstico de prepareArguments, no la cascada
//     de TypeBox, y la llamada no llega a MADE;
//  3. repite la llamada corregida y MADE diseña la definición;
//  4. cierre como AgentSessionRuntime.dispose().
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

const design = (repeat: Record<string, unknown>) => ({
  name: "pr_review_until_approved", version: "1.0", objective: "Review a pull request until the reviewer approves.", outputs: ["verdict"],
  participants: [{ role_id: "REVIEWER" }],
  stages: [{ id: "review_round", group: { steps: [{ id: "review", owner_role_id: "REVIEWER", instructions: "Review the change." }], repeat } }],
});
const FLAT = design({ max_iterations: 4, step: "review", output_field: "verdict", equals: "approve" });
const FIXED = design({ max_iterations: 4, until: { step: "review", output_field: "verdict", equals: "approve" } });
type Result = { role: string; toolName?: string; isError?: boolean; content?: { type: string; text?: string }[] };
const call = (args: Record<string, unknown>, id: string) => () => ai.fauxAssistantMessage(ai.fauxToolCall("made_design_ceremony", args, { id }), { stopReason: "toolUse" });
let outcomes: { error: boolean; text: string }[] = [];

const faux = ai.fauxProvider({ provider: "f1-faux", models: [{ id: "f1-faux-model" }] });
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
await session.modelRuntime.setRuntimeApiKey("f1-faux", "faux");
const extensionErrors: string[] = [];
await session.bindExtensions({ onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !session.getAllTools().some((t: { name: string }) => t.name === "made_design_ceremony")) await new Promise((r) => setTimeout(r, 200));

await session.prompt("/underpass-phase design");
faux.setResponses([
  call(FLAT, "f1a"),
  call(FIXED, "f1b"),
  (c: { messages: Result[] }) => {
    outcomes = c.messages.filter((m) => m.role === "toolResult" && m.toolName === "made_design_ceremony")
      .map((m) => ({ error: m.isError === true, text: (m.content ?? []).map((x) => x.text ?? "").join("") }));
    return ai.fauxAssistantMessage("done");
  },
]);
await session.prompt("design a pull request review that repeats until approved");
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();

const [flat, fixed] = outcomes;
const checks = {
  flatRefused: flat?.error === true,
  flatFocused: flat !== undefined && flat.text.startsWith("made_design_ceremony: the arguments do not match its input schema.")
    && flat.text.includes("stages[0].group.repeat: unknown fields \"step\", \"output_field\", \"equals\"; allowed: max_iterations, until"),
  noCascade: flat !== undefined && !/schema is false|owner_role_id|Validation failed/.test(flat.text),
  fixedDesigned: fixed?.error === false,
  noExtensionErrors: extensionErrors.length === 0,
};
console.log(JSON.stringify({ flat: flat?.text, fixed: fixed?.text.slice(0, 160), extensionErrors, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
