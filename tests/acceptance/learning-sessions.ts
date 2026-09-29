#!/usr/bin/env node
// Uso: node tests/acceptance/learning-sessions.ts <proyecto> [peticiones=8] [fase=design]
//
// Aceptación de L1 (spec §10): una sesión real de Pi por el SDK, con el modelo sustituido
// por el proveedor `faux` de pi-ai (sin red), las extensiones de ESTE checkout y el host
// real del proyecto (tools de KMP y MADE reales).
//  1. /underpass-phase <fase> (una decisión por cambio de fase);
//  2. N peticiones: en cada una (una decisión en agent_start) el modelo faux llama a una
//     tool candidata de KMP que esté activa en ese momento, rotando, con un centinela en
//     los argumentos, y termina;
//  3. tras cada petición, qué tools de KMP y MADE quedaron activas;
//  4. /underpass-status por el comando registrado;
//  5. cierre como AgentSessionRuntime.dispose().
// Con LEARNING_EXPECT=shadow, todas las peticiones deben ver el conjunto completo de la
// fase; con LEARNING_EXPECT=active (y LEARNING_K), al menos una debe verlo reducido a
// mínimo + k como mucho. Siempre: nada fuera de la fase y la línea `learning:` en el estado.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Phase } from "../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../src/domain/session/PhaseToolSelection.ts";

const prefix = process.env.PI_RUNTIME_PREFIX ?? join(process.env.HOME!, ".local/share/pi-runtime/pi-0.87.1");
const pkgDir = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
const main = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = typeof main.exports === "string" ? main.exports : main.exports?.["."]?.import ?? main.exports?.["."]?.default ?? main.main;
const sdk = await import(pathToFileURL(join(pkgDir, entry)).href);
const ai = await import(pathToFileURL(join(pkgDir, "node_modules/@earendil-works/pi-ai/dist/compat.js")).href);
const root = new URL("../../", import.meta.url).pathname;
const cwd = process.argv[2] ?? process.cwd();
const requests = Number(process.argv[3] ?? 8);
const phase = Phase.of(process.argv[4] ?? "design");
const expect = process.env.LEARNING_EXPECT ?? "shadow";
const k = Number(process.env.LEARNING_K ?? 12);
const FLOOR = ["kmp_ask", "kmp_wake", "made_discover_capabilities", "made_get_status"];
const allowed = new Set(PhaseToolSelection.standard().allowed(phase).map(String));
const ours = (names: string[]) => names.filter((n) => n.startsWith("kmp_") || n.startsWith("made_")).sort();

const sentinel = `L1SENTINEL${randomUUID().replace(/-/g, "")}`;
const faux = ai.fauxProvider({ provider: "l1-faux", models: [{ id: "l1-faux-model" }] });
const about = process.env.L1_ABOUT ?? "project:kmp";

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
await session.modelRuntime.setRuntimeApiKey("l1-faux", "faux");
const notes: string[] = [];
const noop = () => undefined;
const uiContext: Record<string, unknown> = Object.fromEntries(["addAutocompleteProvider", "confirm", "custom", "editor", "getEditorText", "input", "onTerminalInput", "pasteToEditor", "select", "setEditorText", "setFooter", "setHeader", "setHiddenThinkingLabel", "setStatus", "setTitle", "setWidget", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"].map((key) => [key, noop]));
uiContext.notify = (m: string) => { notes.push(String(m)); };
const extensionErrors: string[] = [];
await session.bindExtensions({ uiContext, onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 15_000;
while (Date.now() < deadline && !session.getActiveToolNames().includes("kmp_ask")) await new Promise((r) => setTimeout(r, 200));

await session.prompt(`/underpass-phase ${phase.value}`);
await new Promise((r) => setTimeout(r, 300)); // la decisión del cambio de fase va en segundo plano
// El conjunto completo de la fase: lo que la fase permite de lo registrado (no lo activo,
// que en active ya puede venir reducido por la decisión del cambio de fase).
const full = ours(session.getAllTools().map((t: { name: string }) => t.name)).filter((t) => allowed.has(t));
const floor = full.filter((t) => FLOOR.includes(t));

// El modelo faux decide en el momento de la llamada al LLM, con las tools ya elegidas por L1.
const pick = (n: number) => () => {
  const candidates = ours(session.getActiveToolNames()).filter((t) => t.startsWith("kmp_") && !FLOOR.includes(t));
  const tool = candidates.length > 0 ? candidates[n % candidates.length] : "kmp_ask";
  return ai.fauxAssistantMessage(ai.fauxToolCall(tool, { about, question: `${sentinel} ${n}` }, { id: `call${n}${sentinel.slice(10, 18)}` }), { stopReason: "toolUse" });
};
const perRequest: { request: number; active: number; outsidePhase: string[]; missingFloor: string[] }[] = [];
for (let n = 1; n <= requests; n++) {
  faux.setResponses([pick(n), ai.fauxAssistantMessage(`done ${n}`)]);
  await session.prompt(`request ${n}`);
  const active = ours(session.getActiveToolNames());
  perRequest.push({ request: n, active: active.length, outsidePhase: active.filter((t) => !allowed.has(t)), missingFloor: floor.filter((t) => !active.includes(t)) });
}

await session.prompt("/underpass-status");
const sid = session.sessionManager.getSessionId();
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();

const learning = notes.join("\n").split("\n").find((l) => l.startsWith("learning: ")) ?? null;
const checks = {
  phaseApplied: full.length > 0 && full.every((t) => allowed.has(t)),
  neverOutsidePhase: perRequest.every((r) => r.outsidePhase.length === 0),
  floorAlwaysActive: floor.length > 0 && perRequest.every((r) => r.missingFloor.length === 0),
  statusLearningLine: learning !== null,
  expected: expect === "active"
    ? perRequest.some((r) => r.active < full.length && r.active <= floor.length + k)
    : perRequest.every((r) => r.active === full.length),
  noExtensionErrors: extensionErrors.length === 0,
};
console.log(JSON.stringify({ sessionId: sid, sentinel, phase: phase.value, fullSet: full.length, perRequest, learning, extensionErrors, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
