import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { StdioMcpConnection } from "../../../../../src/adapters/outbound/mcp/StdioMcpConnection.ts";
import { StdioMcpConnector } from "../../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { McpRpcError } from "../../../../../src/adapters/outbound/mcp/McpRpcError.ts";
import { McpTransportError } from "../../../../../src/adapters/outbound/mcp/McpTransportError.ts";
import { ServerName } from "../../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../../src/domain/mcp/ToolName.ts";
import { ToolSuccess } from "../../../../../src/domain/mcp/ToolSuccess.ts";
import { ToolRefusal } from "../../../../../src/domain/mcp/ToolRefusal.ts";

const fake = new URL("../../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;
const open = (flavor = "kmp", timeout = 2000) =>
  new StdioMcpConnector(timeout).open(ServerName.of(flavor), { command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: flavor } });

test("handshake y catálogo", async () => {
  const c = await open();
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    assert.equal(c.identity.name, "fake-kmp");
    assert.deepEqual((await c.catalog()).names().map(String), ["kmp_die", "kmp_echo", "kmp_fail", "kmp_slow"]);
  } finally { await c.close(); }
});

test("éxito, negativa y error RPC", async () => {
  const c = await open("made");
  try {
    assert.ok((await c.call(ToolName.of("made_echo"), { v: "x" })) instanceof ToolSuccess);
    const r = await c.call(ToolName.of("made_fail"), {});
    assert.ok(r instanceof ToolRefusal && r.code.value === "refused");
    await assert.rejects(c.call(ToolName.of("made_nope"), {}), (e) => e instanceof McpRpcError && e.code === -32602);
  } finally { await c.close(); }
});

test("correlación por id con peticiones en vuelo", async () => {
  const c = await open();
  try {
    const [a, b] = await Promise.all([c.call(ToolName.of("kmp_slow"), {}), c.call(ToolName.of("kmp_echo"), {})]);
    assert.ok(a instanceof ToolSuccess && b instanceof ToolSuccess);
  } finally { await c.close(); }
});

test("timeout y muerte del proceso son McpTransportError", async () => {
  const slow = await open("kmp", 100);
  try { await assert.rejects(slow.call(ToolName.of("kmp_slow"), {}), (e) => e instanceof McpTransportError && /outcome unknown/.test(e.message)); }
  finally { await slow.close(); }
  const dying = await open();
  let exited = false;
  dying.onExit(() => { exited = true; });
  await assert.rejects(dying.call(ToolName.of("kmp_die"), {}), (e) => e instanceof McpTransportError && /stderr: dying now/.test(e.message));
  assert.equal(exited, true);
  await assert.rejects(dying.call(ToolName.of("kmp_echo"), {}), /not running/);
  await dying.close();
});

test("spawn de un binario inexistente falla con McpTransportError y no tumba el proceso de test", async () => {
  await assert.rejects(
    new StdioMcpConnector(2000).open(ServerName.of("kmp"), { command: "/nonexistent/binary", args: [], cwd: process.cwd(), env: process.env as Record<string, string | undefined> }),
    McpTransportError,
  );
});

test("un error RPC en el handshake mata al hijo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-mcp-pid-"));
  const pidFile = join(dir, "pid");
  await assert.rejects(
    new StdioMcpConnector(2000).open(ServerName.of("kmp"), {
      command: process.execPath,
      args: [fake],
      cwd: process.cwd(),
      env: { ...process.env, FAKE_FLAVOR: "kmp", FAKE_INIT_ERROR: "1", FAKE_PID_FILE: pidFile },
    }),
    McpRpcError,
  );
  await new Promise((r) => setTimeout(r, 300));
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("una inundación de stderr no bloquea el handshake ni el catálogo", async () => {
  const c = await new StdioMcpConnector(5000).open(ServerName.of("kmp"), {
    command: process.execPath,
    args: [fake],
    cwd: process.cwd(),
    env: { ...process.env, FAKE_FLAVOR: "kmp", FAKE_STDERR_FLOOD: "1" },
  });
  try {
    assert.equal(c.protocol.value, "2024-11-05");
    assert.ok((await c.catalog()).names().length > 0);
  } finally { await c.close(); }
});

const spawnNode = (code: string) => spawn(process.execPath, ["-e", code], { stdio: ["pipe", "pipe", "pipe"] });

test("un 'error' en stdin del hijo marca la conexión caída sin lanzar", async () => {
  const child = spawnNode("setTimeout(() => {}, 10_000)");
  const conn = new StdioMcpConnection(ServerName.KMP, child, 5000);
  let exited = false;
  conn.onExit(() => { exited = true; });
  const pending = conn.catalog();
  child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  await assert.rejects(pending, (e) => e instanceof McpTransportError && /EPIPE/.test(e.message));
  assert.equal(exited, true);
  await assert.rejects(conn.catalog(), /not running/);
  child.kill("SIGKILL");
});

test("escribir a un hijo que cerró su stdin (EPIPE real) rechaza en vez de tumbar el proceso", async () => {
  const child = spawnNode("require('node:fs').closeSync(0); setTimeout(() => {}, 2000)");
  const conn = new StdioMcpConnection(ServerName.KMP, child, 5000);
  await new Promise((r) => setTimeout(r, 200));
  const big = { blob: "x".repeat(1 << 20) };
  await assert.rejects(conn.call(ToolName.of("kmp_echo"), big), McpTransportError);
  child.kill("SIGKILL");
});
