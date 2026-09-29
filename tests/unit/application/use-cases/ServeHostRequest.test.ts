import { test } from "node:test";
import assert from "node:assert/strict";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";

const fake = new URL("../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;
const project = Project.of(ProjectRoot.of(process.cwd()));
const factory = (flavor: string) => ({ commandFor: () => ({ command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: flavor } }) });

test("health, catálogo, éxito, negativa, RPC e inválidos", async () => {
  const pool = new ServerPool(project, new StdioMcpConnector(2000), new Map([["kmp", factory("kmp")], ["made", factory("made")]]));
  const uc = new ServeHostRequest(project, pool);
  try {
    assert.deepEqual(await uc.execute({ id: 1, method: "health" }), { id: 1, ok: true, result: { project: process.cwd(), started: [] } });
    const cat = await uc.execute({ id: 2, method: "catalog", server: "kmp" });
    assert.ok(cat.ok && (cat.result as { tools: unknown[] }).tools.length === 4);
    assert.deepEqual(await uc.execute({ id: 3, method: "call", server: "kmp", tool: "kmp_echo", args: { a: 1 } }), { id: 3, ok: true, result: { structured: { a: 1 }, text: "{\"a\":1}" } });
    assert.deepEqual(await uc.execute({ id: 4, method: "call", server: "made", tool: "made_fail", args: {} }), { id: 4, ok: false, error: { kind: "refused", code: "refused", message: "no grant" } });
    const rpc = await uc.execute({ id: 5, method: "call", server: "kmp", tool: "kmp_nope", args: {} });
    assert.ok(!rpc.ok && rpc.error.kind === "rpc" && rpc.error.code === -32602);
    const bad = await uc.execute({ id: 6, method: "call", server: "zzz", tool: "x", args: {} });
    assert.ok(!bad.ok && bad.error.kind === "invalid");
  } finally { await pool.close(); }
});
