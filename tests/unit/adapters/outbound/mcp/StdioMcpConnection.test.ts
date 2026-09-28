import { test } from "node:test";
import assert from "node:assert/strict";
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
  await assert.rejects(dying.call(ToolName.of("kmp_die"), {}), McpTransportError);
  assert.equal(exited, true);
  await assert.rejects(dying.call(ToolName.of("kmp_echo"), {}), /not running/);
  await dying.close();
});
