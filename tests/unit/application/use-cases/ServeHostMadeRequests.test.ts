import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import { IssuedGrants } from "../../../../src/application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { DeclineMadeConfirmation } from "../../../../src/application/use-cases/DeclineMadeConfirmation.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const project = Project.of(ProjectRoot.of(process.cwd()));
const S1 = StreamId.session(SessionId.of("s1"));
const YAML = "name: pr_review_two_reviewers\nversion: \"1.0\"\n";
const kmp = new URL("../../../fixtures/fake-mcp-server.ts", import.meta.url).pathname;

function host() {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  record.execute(fact("session.opened", "o", { reason: "startup" }, S1, clock.ms));
  const connection = async () => made; const facts = new MadeFactFactory(clock, Actor.of("host", "host:1"));
  let n = 0; const confirmations = new PendingConfirmations({ bytes: (k) => new Uint8Array(k).fill(++n) }, clock);
  const deps = {
    call: new CallMadeTool({ connection, owner: new MadeOwner(connection), policy: MadeActionPolicy.standard(), confirmations, grants: new IssuedGrants(), record, facts, clock, log: null }),
    decline: new DeclineMadeConfirmation(confirmations, record, facts),
  };
  const pool = new ServerPool(project, new StdioMcpConnector(2000), new Map([["kmp", { commandFor: () => ({ command: process.execPath, args: [kmp], cwd: process.cwd(), env: { ...process.env, FAKE_FLAVOR: "kmp" } }) }]]));
  return { made, events, pool, uc: new ServeHostRequest(project, pool, record, null, null, null, deps) };
}
const confirmations = (events: InMemoryEventStore) => events.readStream(S1).filter((r) => r.type.value === "made.confirmation").map((r) => (r.payload.toValue() as { outcome: string }).outcome);

test("call a MADE con sesión y fase: la lectura se concede sola y KMP no pasa por la autorización", async () => {
  const h = host();
  try {
    const ok = await h.uc.execute({ id: 1, method: "call", server: "made", tool: "made_validate_ceremony_draft", args: { definition_yaml: YAML }, sessionId: "s1", phase: "design" });
    assert.deepEqual(ok, { id: 1, ok: true, result: { structured: { tool: "made_validate_ceremony_draft", ok: true }, text: "made_validate_ceremony_draft ok" } });
    const legacy = await h.uc.execute({ id: 2, method: "call", server: "made", tool: "made_list_contracts", args: {} });
    assert.ok(!legacy.ok && legacy.error.kind === "refused" && legacy.error.code === "refused", "sin sesión: la denegación original");
    const echo = await h.uc.execute({ id: 3, method: "call", server: "kmp", tool: "kmp_echo", args: { a: 1 }, sessionId: "s1", phase: "design" });
    assert.ok(echo.ok);
    const bad = await h.uc.execute({ id: 4, method: "call", server: "made", tool: "made_list_contracts", args: {}, sessionId: "s1", phase: "cooking" });
    assert.ok(!bad.ok && bad.error.kind === "invalid");
  } finally { await h.pool.close(); }
});

test("needs_confirmation lleva token, acción y alcance; el token confirma una vez y el rechazo se registra", async () => {
  const h = host();
  try {
    const call = (id: number, confirmation?: string) => h.uc.execute({ id, method: "call", server: "made", tool: "made_publish_ceremony_definition", args: { definition_yaml: YAML }, sessionId: "s1", phase: "design", confirmation });
    const asked = await call(1);
    assert.ok(!asked.ok && asked.error.code === "needs_confirmation", JSON.stringify(asked));
    const c = asked.error.confirmation!;
    assert.deepEqual({ ...c, token: "t" }, { token: "t", action: "publish_ceremony_definition", scopeSummary: "definition pr_review_two_reviewers v1.0" });
    assert.equal(asked.error.message, "publish_ceremony_definition on definition pr_review_two_reviewers v1.0 needs human confirmation");
    assert.match(c.token, /^[0-9a-f]{32}$/);
    assert.ok((await call(2, c.token)).ok);

    const again = await call(3);
    assert.ok(again.ok, "el grant de 5 min sigue vivo");
    h.made.grants.clear();
    const second = await call(4);
    const token = !second.ok ? second.error.confirmation!.token : "";
    assert.deepEqual(await h.uc.execute({ id: 5, method: "confirmation", sessionId: "s1", token, outcome: "declined" }), { id: 5, ok: true, result: { recorded: true } });
    assert.deepEqual(await h.uc.execute({ id: 6, method: "confirmation", sessionId: "s1", token, outcome: "declined" }), { id: 6, ok: true, result: { recorded: false } });
    const noUi = await call(7);
    const t2 = !noUi.ok ? noUi.error.confirmation!.token : "";
    assert.deepEqual(await h.uc.execute({ id: 8, method: "confirmation", sessionId: "s1", token: t2, outcome: "no_ui" }), { id: 8, ok: true, result: { recorded: true } });
    assert.deepEqual(confirmations(h.events), ["accepted", "declined", "no_ui"]);
    for (const [token, outcome] of [[t2, "accepted"], ["zz", "declined"], [t2, "maybe"]]) {
      const bad = await h.uc.execute({ id: 9, method: "confirmation", sessionId: "s1", token, outcome });
      assert.ok(!bad.ok && bad.error.kind === "invalid", `${token} ${outcome}`);
    }
  } finally { await h.pool.close(); }
});

test("sin autorización de MADE cableada, confirmation es invalid y MADE va directo al pool", async () => {
  const uc = new ServeHostRequest(project, new ServerPool(project, new StdioMcpConnector(2000), new Map()));
  assert.deepEqual(await uc.execute({ id: 1, method: "confirmation", sessionId: "s1", token: "ab".repeat(16), outcome: "declined" }),
    { id: 1, ok: false, error: { kind: "invalid", message: "made authorization not available" } });
  const res = await uc.execute({ id: 2, method: "call", server: "made", tool: "made_list_contracts", args: {}, sessionId: "s1", phase: "design" });
  assert.ok(!res.ok && res.error.kind === "transport");
});
