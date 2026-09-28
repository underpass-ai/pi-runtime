import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnixSocketHostServer } from "../../../../src/adapters/inbound/ipc/UnixSocketHostServer.ts";
import { UnixSocketHostGateway } from "../../../../src/adapters/outbound/ipc/UnixSocketHostGateway.ts";
import { HostCallError } from "../../../../src/application/ports/HostCallError.ts";
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

test("los argumentos con UTF-8 multibyte llegan intactos en el viaje de ida y vuelta", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, async (req) => {
    if (req.method === "call") return { id: req.id, ok: true, result: { structured: req.args, text: "ok" } };
    return { id: req.id, ok: false, error: { kind: "invalid", message: "unexpected" } };
  });
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    const payload = { text: "ñ漢😀" };
    assert.deepEqual(await gw.call(ServerName.KMP, ToolName.of("kmp_ask"), payload), { structured: payload, text: "ok" });
    gw.close();
  } finally { await server.close(); }
});

test("una línea malformada del host rechaza lo pendiente sin tumbar el cliente", async () => {
  const path = sock();
  const raw = createServer((sock) => sock.once("data", () => sock.write("esto no es json\n")));
  await new Promise<void>((resolve) => raw.listen(path, resolve));
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    await assert.rejects(gw.health(), (e) => e instanceof HostCallError && e.kind === "transport" && e.message === "malformed response from host");
    gw.close();
  } finally { await new Promise<void>((resolve) => raw.close(() => resolve())); }
});

test("el host rechaza escuchar si el directorio del socket no es privado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ipc-open-"));
  chmodSync(dir, 0o755);
  const path = join(dir, "host.sock");
  await assert.rejects(UnixSocketHostServer.start(path, async (req) => ({ id: req.id, ok: true, result: null })));
});

const within = <T>(p: Promise<T>, ms = 1000) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms).unref())]);

test("con el host muerto, lo pendiente y lo siguiente se rechazan al momento y onClose avisa", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, () => new Promise(() => {}));
  const gw = await UnixSocketHostGateway.connect(path);
  let closes = 0;
  gw.onClose(() => { closes++; });
  const pending = gw.health();
  await server.close();
  await within(assert.rejects(pending, (e) => e instanceof HostCallError && e.kind === "transport"));
  await within(assert.rejects(gw.health(), (e) => e instanceof HostCallError && e.kind === "transport" && e.message === "host connection closed"));
  assert.equal(closes, 1);
  let late = 0;
  gw.onClose(() => { late++; });
  await new Promise((r) => setImmediate(r));
  assert.equal(late, 1, "un oyente registrado tras el cierre se avisa igual");
});

test("close() propio también deja el gateway cerrado", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, async (req) => ({ id: req.id, ok: true, result: { project: "/p", started: [] } }));
  try {
    const gw = await UnixSocketHostGateway.connect(path);
    gw.close();
    await within(assert.rejects(gw.health(), (e) => e instanceof HostCallError && e.kind === "transport"));
  } finally { await server.close(); }
});

test("una línea JSON que no es un objeto (null, número) se trata como respuesta malformada", async () => {
  for (const bad of ["null", "5", "\"x\""]) {
    const path = sock();
    const raw = createServer((s) => s.once("data", () => s.write(`${bad}\n`)));
    await new Promise<void>((resolve) => raw.listen(path, resolve));
    try {
      const gw = await UnixSocketHostGateway.connect(path);
      await within(assert.rejects(gw.health(), (e) => e instanceof HostCallError && e.message === "malformed response from host"));
      gw.close();
    } finally { await new Promise<void>((resolve) => raw.close(() => resolve())); }
  }
});

test("close() no borra un socket que otro host puso en la misma ruta", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, async (req) => ({ id: req.id, ok: true, result: null }));
  rmSync(path);
  writeFileSync(path, "otro host"); // otro inodo en la misma ruta
  await server.close();
  assert.equal(existsSync(path), true);
  assert.equal(readFileSync(path, "utf8"), "otro host");
});

test("close() sí borra su propio socket", async () => {
  const path = sock();
  const server = await UnixSocketHostServer.start(path, async (req) => ({ id: req.id, ok: true, result: null }));
  await server.close();
  assert.equal(existsSync(path), false);
});
