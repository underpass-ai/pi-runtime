#!/usr/bin/env node
// Uso: node tests/acceptance/spool-recovery.ts <proyecto>
//
// Aceptación de E1 (spec §5.2): una sesión real de Pi por el SDK, con el
// modelo sustituido por el proveedor `faux` de pi-ai (respuestas guionizadas,
// sin red) y las tools de KMP reales a través del host del proyecto.
//  1. llamada a kmp_ask con el host vivo;
//  2. el host se mata y se mantiene caído (pkill en bucle) durante la segunda
//     llamada: la tool falla sin bloquear Pi y los hechos quedan en el spool;
//  3. se deja de matar: la tercera llamada relanza el host y el spool se
//     reenvía;
//  4. /underpass-status por el comando registrado, con un uiContext que
//     recoge notify;
//  5. cierre como lo hace AgentSessionRuntime.dispose(): session_shutdown y
//     después dispose().
// Imprime un JSON con el id de sesión, el centinela usado en los argumentos y
// lo observado en el spool; el operador comprueba después `events show`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const prefix = process.env.PI_RUNTIME_PREFIX ?? join(process.env.HOME!, ".local/share/pi-runtime/pi-0.87.1");
const pkgDir = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
const main = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = typeof main.exports === "string" ? main.exports : main.exports?.["."]?.import ?? main.exports?.["."]?.default ?? main.main;
const sdk = await import(pathToFileURL(join(pkgDir, entry)).href);
const ai = await import(pathToFileURL(join(pkgDir, "node_modules/@earendil-works/pi-ai/dist/compat.js")).href);
const root = new URL("../../", import.meta.url).pathname;
const cwd = process.argv[2] ?? process.cwd();

const stateDir = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "pi-runtime/projects");
// Sólo los ficheros de este proceso (<pid>.jsonl / <pid>.gap): otros procesos
// tienen su propio spool.
const spoolFiles = () => readdirSync(stateDir).flatMap((p) => { const d = join(stateDir, p, "spool"); return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith(`${process.pid}.`)).map((f) => `${p}/spool/${f}`) : []; });
// El patrón con corchetes no casa con la línea de órdenes del propio pkill.
const killHosts = () => { try { execFileSync("pkill", ["-f", "underpass-host[.]ts"]); } catch { /* ninguno vivo */ } };
const hostsAlive = () => { try { return execFileSync("pgrep", ["-f", "underpass-host[.]ts"]).toString().trim().split("\n").length; } catch { return 0; } };

const sentinel = `E1SENTINEL${randomUUID().replace(/-/g, "")}`;
const faux = ai.fauxProvider({ provider: "e1-faux", models: [{ id: "e1-faux-model" }] });
// El about debe existir en la memoria del proyecto para que KMP conteste (con
// uno inexistente la llamada llega igual al host y sale `refused`).
const about = process.env.E1_ABOUT ?? "project:kmp";
const ask = (n: number) => ai.fauxAssistantMessage(ai.fauxToolCall("kmp_ask", { about, question: `${sentinel} question ${n}` }, { id: `call${n}${sentinel.slice(10, 18)}` }), { stopReason: "toolUse" });
const done = (n: number) => ai.fauxAssistantMessage(`done ${n}`);

const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd, agentDir: sdk.getAgentDir(), settingsManager, noExtensions: true,
  additionalExtensionPaths: ["host", "kmp", "made"].map((e) => join(root, "src/adapters/inbound/pi/entry", `${e}.ts`)),
});
await resourceLoader.reload();
const loaded = resourceLoader.getExtensions();
if (loaded.errors.length) { console.error(loaded.errors); process.exit(1); }
const { session } = await sdk.createAgentSession({ cwd, resourceLoader, settingsManager, model: faux.getModel(), sessionManager: sdk.SessionManager.inMemory(cwd) });
// Proveedor y clave sólo en memoria (RuntimeCredentials): el faux no usa la
// clave y nada se persiste en ~/.pi/agent.
session.modelRuntime.registerNativeProvider(faux.provider);
await session.modelRuntime.setRuntimeApiKey("e1-faux", "faux");
const notes: string[] = [];
// Pi copia el uiContext (no vale un Proxy): métodos propios, notify recoge.
const noop = () => undefined;
const uiContext: Record<string, unknown> = Object.fromEntries(["addAutocompleteProvider", "confirm", "custom", "editor", "getEditorText", "input", "onTerminalInput", "pasteToEditor", "select", "setEditorText", "setFooter", "setHeader", "setHiddenThinkingLabel", "setStatus", "setTitle", "setWidget", "setWorkingIndicator", "setWorkingMessage", "setWorkingVisible"].map((k) => [k, noop]));
uiContext.notify = (m: string) => { notes.push(String(m)); };
const extensionErrors: string[] = [];
await session.bindExtensions({ uiContext, onError: (e: { error: string; event: string }) => extensionErrors.push(`${e.event}: ${e.error}`) });
const deadline = Date.now() + 15_000;
while (Date.now() < deadline && !session.getActiveToolNames().includes("kmp_ask")) await new Promise((r) => setTimeout(r, 200));

const results: { call: number; isError: boolean; transport: boolean; ms: number }[] = [];
const textOf = (r: unknown) => String((r as { content?: { text?: string }[] })?.content?.[0]?.text ?? "");
const started = new Map<string, number>();
session.subscribe((e: { type: string; toolCallId?: string; isError?: boolean; result?: unknown }) => {
  if (process.env.E1_DEBUG && e.type === "tool_execution_end") console.error(JSON.stringify(e.result).slice(0, 400));
  if (e.type === "tool_execution_start") started.set(e.toolCallId!, Date.now());
  if (e.type === "tool_execution_end") results.push({ call: results.length + 1, isError: e.isError === true, transport: / transport \(/.test(textOf(e.result)), ms: Date.now() - (started.get(e.toolCallId!) ?? Date.now()) });
});
const turn = async (n: number) => { faux.setResponses([ask(n), done(n)]); await session.prompt(`turn ${n}`); };

await turn(1);
const spoolAfter1 = spoolFiles();

killHosts();
const killer = setInterval(killHosts, 50);
let turn2Ms: number, spoolWhileDown: string[], spooledFacts: number;
try {
  const t2 = Date.now();
  await turn(2);
  turn2Ms = Date.now() - t2;
  // El host sigue caído más de lo que ConnectToProjectHost espera a un
  // relanzamiento (5 s): los envíos directos agotan su reintento y van al spool.
  await new Promise((r) => setTimeout(r, Number(process.env.E1_DOWN_MS ?? 7_000)));
  spoolWhileDown = spoolFiles();
  spooledFacts = spoolWhileDown.filter((f) => f.endsWith(".jsonl")).reduce((n, f) => n + readFileSync(join(stateDir, f), "utf8").split("\n").filter(Boolean).length, 0);
} finally { clearInterval(killer); }
// Deja que los cierres de socket y un drain pendiente se asienten.
await new Promise((r) => setTimeout(r, 1_000));

await turn(3);
await new Promise((r) => setTimeout(r, 500));
const hostsAfter = hostsAlive();

await session.prompt("/underpass-status");
const sid = session.sessionManager.getSessionId();
await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
session.dispose();
const spoolAtEnd = spoolFiles();

const checks = {
  call1Ok: results[0]?.isError === false,
  call2Transport: results[1]?.transport === true,
  call2FailedWithoutBlocking: results[1]?.isError === true && turn2Ms < 15_000,
  spoolFilledWhileDown: spoolWhileDown.some((f) => f.endsWith(".jsonl")),
  hostRelaunched: hostsAfter > 0,
  call3Ok: results[2]?.isError === false,
  spoolEmptyAtEnd: spoolAtEnd.length === 0,
  statusShown: notes.some((n) => n.includes("session:")),
};
console.log(JSON.stringify({ sessionId: sid, sentinel, results, turn2Ms, spoolAfter1, spoolWhileDown, spooledFacts, spoolAtEnd, status: notes, extensionErrors, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
