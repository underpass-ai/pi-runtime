import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { ServerName } from "../../../../src/domain/mcp/ServerName.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";

const fake = new URL("../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;
const project = Project.of(ProjectRoot.of(process.cwd()));
const factory = (flavor: string) => ({ commandFor: () => ({ command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: flavor } }) });
const pool = (connector = new StdioMcpConnector(2000)) => new ServerPool(project, connector, new Map([["kmp", factory("kmp")], ["made", factory("made")]]));

test("perezoso, una sola apertura con llamadas concurrentes", async () => {
  let opens = 0;
  const inner = new StdioMcpConnector(2000);
  const p = pool({ open: (s, c) => { opens++; return inner.open(s, c); } });
  try {
    assert.deepEqual(p.started(), []);
    await Promise.all([p.connection(ServerName.KMP), p.connection(ServerName.KMP)]);
    assert.equal(opens, 1);
    assert.deepEqual(p.started().map(String), ["kmp"]);
  } finally { await p.close(); }
});

test("relanza tras la muerte del servidor", async () => {
  const p = pool();
  try {
    const first = await p.connection(ServerName.KMP);
    const exited = new Promise<void>((r) => first.onExit(r)); // el pool registró su oyente antes: ya lo habrá olvidado
    await assert.rejects(first.call(ToolName.of("kmp_die"), {}));
    await exited;
    const again = await p.connection(ServerName.KMP);
    assert.equal((await again.catalog()).names().length, 4);
  } finally { await p.close(); }
});

test("sin factoría para un servidor falla con un mensaje claro", async () => {
  const p = new ServerPool(project, new StdioMcpConnector(), new Map());
  await assert.rejects(p.connection(ServerName.MADE), /no command for made/);
});

test("connection() tras close() rechaza", async () => {
  const p = pool();
  await p.close();
  await assert.rejects(p.connection(ServerName.KMP), /server pool closed/);
});

test("close() durante una apertura en curso: el llamante rechaza y la conexión abierta se cierra", async () => {
  let closed = false;
  const fakeConn = { server: ServerName.KMP, onExit: () => {}, close: async () => { closed = true; } };
  let resolveOpen!: (c: typeof fakeConn) => void;
  const opening = new Promise<typeof fakeConn>((r) => { resolveOpen = r; });
  const p = new ServerPool(project, { open: () => opening }, new Map([["kmp", factory("kmp")]]));
  const pending = p.connection(ServerName.KMP);
  const closing = p.close();
  resolveOpen(fakeConn);
  await assert.rejects(pending, /server pool closed/);
  await closing;
  assert.equal(closed, true);
});
