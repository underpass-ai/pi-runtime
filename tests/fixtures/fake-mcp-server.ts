#!/usr/bin/env node
import { createInterface } from "node:readline";
import { writeFileSync, writeSync } from "node:fs";

const flavor = process.env.FAKE_FLAVOR ?? "kmp";
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
if (process.env.FAKE_STDERR_FLOOD) { const chunk = "x".repeat(8192); for (let i = 0; i < 32; i++) writeSync(2, chunk); }
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
const reply = (id: unknown, result: unknown) => out({ jsonrpc: "2.0", id, result });
const error = (id: unknown, code: number, message: string) => out({ jsonrpc: "2.0", id, error: { code, message } });
const extra = (process.env.FAKE_EXTRA_TOOLS ?? "").split(",").filter((n) => n !== "");
const tools = ["echo", "fail", "slow", "die", ...extra].map((n) => ({ name: `${flavor}_${n}`, description: n, inputSchema: { type: "object" } }));

for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (msg.id === undefined) continue;
  if (msg.method === "initialize") {
    if (process.env.FAKE_INIT_ERROR) { error(msg.id, -32000, "init refused"); continue; }
    reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: `fake-${flavor}`, version: "0.0.1" } });
    continue;
  }
  if (msg.method === "tools/list") { reply(msg.id, { tools }); continue; }
  if (msg.method !== "tools/call") { error(msg.id, -32601, "method not found"); continue; }
  const { name, arguments: args } = msg.params;
  if (name === `${flavor}_echo`) reply(msg.id, { content: [{ type: "text", text: JSON.stringify(args) }], structuredContent: args, isError: false });
  else if (name === `${flavor}_fail` && flavor === "kmp") reply(msg.id, { content: [{ type: "text", text: "nf" }], structuredContent: { error: { code: "not_found", message: "no such ref" } }, isError: true });
  else if (name === `${flavor}_fail`) reply(msg.id, { content: [{ type: "text", text: "refused: no grant" }], structuredContent: { code: "refused", message: "no grant", retryable: false }, isError: true });
  else if (name === `${flavor}_slow`) { await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLOW_MS ?? 300))); reply(msg.id, { content: [{ type: "text", text: "slow" }], structuredContent: {}, isError: false }); }
  else if (name === `${flavor}_die`) { process.stderr.write("dying now\n"); process.exit(3); }
  else error(msg.id, -32602, "unknown tool");
}
