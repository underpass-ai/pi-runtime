import { test } from "node:test";
import assert from "node:assert/strict";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { ReadSessionSummary } from "../../../../src/application/use-cases/ReadSessionSummary.ts";
import { ReadSessionStatus } from "../../../../src/application/use-cases/ReadSessionStatus.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { SessionSummaryProjection } from "../../../../src/application/projections/SessionSummaryProjection.ts";
import { ToolStatsProjection } from "../../../../src/application/projections/ToolStatsProjection.ts";
import type { FactDto } from "../../../../src/application/dto/FactDto.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { FixedClock } from "../../../support/FixedClock.ts";

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

const opened: FactDto = { stream: "session", sessionId: "s1", type: "session.opened", typeVersion: 1, about: "open", occurredAtMs: 1000, actor: { kind: "agent", id: "pi:1" }, payload: { reason: "startup" } };
const emptyPool = () => new ServerPool(project, new StdioMcpConnector(2000), new Map());

function eventLog() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  const runner = new ProjectionRunner(events, store, [new SessionSummaryProjection(), new ToolStatsProjection()]);
  return { events, runner, record: new RecordFact(events, new FixedClock()), summaries: new ReadSessionStatus(events, new ReadSessionSummary(store, () => runner.runOnce())) };
}

test("record: registra un hecho, es idempotente y una DomainError da invalid", async () => {
  const log = eventLog();
  const uc = new ServeHostRequest(project, emptyPool(), log.record, log.summaries);
  assert.deepEqual(await uc.execute({ id: 1, method: "record", fact: opened }), { id: 1, ok: true, result: { recorded: 1, idempotent: false } });
  assert.deepEqual(await uc.execute({ id: 2, method: "record", fact: opened }), { id: 2, ok: true, result: { recorded: 1, idempotent: true } });
  const bad = await uc.execute({ id: 3, method: "record", fact: { ...opened, type: "nope" } });
  assert.ok(!bad.ok && bad.error.kind === "invalid");
  const conflict = await uc.execute({ id: 4, method: "record", fact: { ...opened, payload: { reason: "otra" } } });
  assert.ok(!conflict.ok && conflict.error.kind === "invalid" && /different content/.test(conflict.error.message));
});

test("record: un fallo que no es de dominio da transport", async () => {
  const broken = { find: () => { throw new Error("disk on fire"); } } as unknown as EventStore;
  const uc = new ServeHostRequest(project, emptyPool(), new RecordFact(broken, new FixedClock()));
  assert.deepEqual(await uc.execute({ id: 1, method: "record", fact: opened }), { id: 1, ok: false, error: { kind: "transport", message: "disk on fire" } });
});

test("record y summary sin log de eventos dan invalid \"event log not available\"", async () => {
  const uc = new ServeHostRequest(project, emptyPool());
  assert.deepEqual(await uc.execute({ id: 1, method: "record", fact: opened }), { id: 1, ok: false, error: { kind: "invalid", message: "event log not available" } });
  assert.deepEqual(await uc.execute({ id: 2, method: "summary", sessionId: "s1" }), { id: 2, ok: false, error: { kind: "invalid", message: "event log not available" } });
});

test("summary: devuelve el resumen tras proyectar, null si no existe e invalid con un id malo", async () => {
  const log = eventLog();
  const uc = new ServeHostRequest(project, emptyPool(), log.record, log.summaries);
  await uc.execute({ id: 1, method: "record", fact: opened });
  const res = await uc.execute({ id: 2, method: "summary", sessionId: "s1" });
  assert.ok(res.ok);
  const status = res.result as { summary: { sessionId: string; openedAt: string }; logPosition: number; sessionChainIntact: boolean };
  assert.equal(status.summary.sessionId, "s1");
  assert.equal(status.summary.openedAt, "1970-01-01T00:00:01.000Z");
  assert.deepEqual([status.logPosition, status.sessionChainIntact], [1, true]);
  assert.deepEqual(await uc.execute({ id: 3, method: "summary", sessionId: "otra" }), { id: 3, ok: true, result: { summary: null, logPosition: 1, sessionChainIntact: true } });
  const bad = await uc.execute({ id: 4, method: "summary", sessionId: "a b" });
  assert.ok(!bad.ok && bad.error.kind === "invalid");
});

test("summary: un fallo que no es de dominio al refrescar da transport", async () => {
  const summaries = new ReadSessionStatus(new InMemoryEventStore(), new ReadSessionSummary(new InMemoryProjectionStore(), () => { throw new Error("projection store gone"); }));
  const uc = new ServeHostRequest(project, emptyPool(), null, summaries);
  assert.deepEqual(await uc.execute({ id: 1, method: "summary", sessionId: "s1" }), { id: 1, ok: false, error: { kind: "transport", message: "projection store gone" } });
});
