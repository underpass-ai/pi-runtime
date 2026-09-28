import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnixSocketHostServer } from "../../../../src/adapters/inbound/ipc/UnixSocketHostServer.ts";
import { UnixSocketHostGateway } from "../../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { HostCallError } from "../../../../src/adapters/outbound/ipc/HostCallError.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";

const sock = () => join(mkdtempSync(join(tmpdir(), "ipc-")), "host.sock");

test("socket 0600, catálogo, llamada, health y errores tipados", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, async (req) => {
    if (req.method === "health") return { id: req.id, ok: true, result: { project: "/p", started: [] } };
    if (req.method === "catalog") return { id: req.id, ok: true, result: { server: "kmp", serverName: "k", serverVersion: "1.0.0", fingerprint: "a".repeat(64), tools: [{ name: "kmp_ask", inputSchema: {} }] } };
    if (req.tool === "kmp_bad") return { id: req.id, ok: false, error: { kind: "refused", code: "not_found", message: "nope" } };
    return { id: req.id, ok: true, result: { structured: req.args, text: "ok" } };
  });
  try {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const gw = await UnixSocketHostGateway.connect(path);
    assert.deepEqual(await gw.health(), { project: "/p", started: [] });
    assert.deepEqual((await gw.catalog(ServerName.KMP)).names().map(String), ["kmp_ask"]);
    assert.deepEqual(await gw.call(ServerName.KMP, ToolName.of("kmp_ask"), { q: 1 }), { structured: { q: 1 }, text: "ok" });
    await assert.rejects(gw.call(ServerName.KMP, ToolName.of("kmp_bad"), {}), (e) => e instanceof HostCallError && e.kind === "refused" && e.code === "not_found");
    assert.equal(server.clients(), 1);
    gw.close();
  } finally { await server.close(); }
});

test("métodos no permitidos y JSON inválido nunca llegan al handler", async () => {
  const path = sock();
  let called = false;
  const server = await UnixSocketHostServer.start(path, async (req) => { called = true; return { id: req.id, ok: true, result: null }; });
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    await assert.rejects(gw.raw({ method: "shutdown" }), (e) => e instanceof HostCallError && e.kind === "denied");
    assert.equal(called, false);
    gw.close();
  } finally { await server.close(); }
});

test("connect con reintentos falla si nadie escucha; el cierre del host rechaza lo pendiente", async () => {
  await assert.rejects(UnixSocketHostGateway.connect(sock(), 2, 10));
  const path = sock();
  const server = await UnixSocketHostServer.start(path, () => new Promise(() => {}));
  const gw = await UnixSocketHostGateway.connect(path);
  const pending = gw.health();
  await server.close();
  await assert.rejects(pending, (e) => e instanceof HostCallError && e.kind === "transport");
});
