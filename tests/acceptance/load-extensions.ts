#!/usr/bin/env node
// Uso: node tests/acceptance/load-extensions.ts <proyecto>
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const prefix = process.env.PI_RUNTIME_PREFIX ?? join(process.env.HOME!, ".local/share/pi-runtime/pi-0.87.1");
const pkgDir = join(prefix, "lib/node_modules/@earendil-works/pi-coding-agent");
const main = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entry = typeof main.exports === "string" ? main.exports : main.exports?.["."]?.import ?? main.exports?.["."]?.default ?? main.main;
const sdk = await import(pathToFileURL(join(pkgDir, entry)).href);
const root = new URL("../../", import.meta.url).pathname;
const cwd = process.argv[2] ?? process.cwd();

const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd, agentDir: sdk.getAgentDir(), settingsManager, noExtensions: true,
  additionalExtensionPaths: ["host", "kmp", "made"].map((e) => join(root, "src/adapters/inbound/pi/entry", `${e}.ts`)),
});
await resourceLoader.reload();
const loaded = resourceLoader.getExtensions();
if (loaded.errors.length) { console.error(loaded.errors); process.exit(1); }
const { session } = await sdk.createAgentSession({ cwd, resourceLoader, settingsManager, sessionManager: sdk.SessionManager.inMemory(cwd) });
await session.bindExtensions({}); // en el SDK, session_start no se dispara solo
const deadline = Date.now() + 15_000;
let names: string[] = [];
while (Date.now() < deadline) {
  names = session.getAllTools().map((t: { name: string }) => t.name);
  if (names.includes("kmp_ask") && names.includes("made_claim_ceremony_step")) break;
  await new Promise((r) => setTimeout(r, 200));
}
const active = session.getActiveToolNames();
const checks = { kmpRegistered: names.includes("kmp_ask"), madeRegistered: names.includes("made_claim_ceremony_step"), kmpActive: active.includes("kmp_ask"), madeControlHidden: !active.includes("made_claim_ceremony_step") };
console.log(JSON.stringify({ tools: names.length, active: active.length, checks }, null, 2));
session.dispose();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
