import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { SqliteMadePolicyCensus } from "../../../../src/adapters/outbound/sqlite/SqliteMadePolicyCensus.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { DiagnoseMadeAuthorization } from "../../../../src/application/use-cases/DiagnoseMadeAuthorization.ts";
import { ReadMadeStatus } from "../../../../src/application/use-cases/ReadMadeStatus.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { CheckSection } from "../../../../src/domain/diagnosis/CheckSection.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeGrant } from "../../../../src/domain/made/MadeGrant.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const STORE = StorePath.of("/s/ceremonies.sqlite3");
const S1 = SessionId.of("s1");
const lines = (checks: { section: CheckSection; status: { value: string }; name: { value: string }; detail: { value: string } }[]) =>
  checks.map((c) => `${c.section.value} ${c.status.value} ${c.name.value} — ${c.detail.value}`);

// Un log con un grant de la sesión s1; `close` la cierra (el grant queda huérfano).
function log(close: boolean) {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  record.execute(fact("session.opened", "o", { reason: "startup" }, StreamId.session(S1), clock.ms));
  record.execute(new MadeFactFactory(clock, Actor.of("host", "host:1")).grantIssued(MadeGrant.issue(S1, MadeAction.of("list_contracts"), MadeScope.GLOBAL, MadeActionClass.AUTO, clock.now())));
  if (close) record.execute(fact("session.closed", "c", { reason: "quit" }, StreamId.session(S1), clock.ms));
  return { clock, events };
}

test("[made-auth] en verde: el host lee la política, sin huérfanos, store propio", async () => {
  const { clock, events } = log(false);
  const checks = await new DiagnoseMadeAuthorization(events, { policies: () => 1 }, STORE, clock).execute(new FakeMade());
  assert.deepEqual(lines(checks), [
    "made-auth OK host authorization — the host owns the MADE policy and can grant exact actions",
    "made-auth OK orphan grants — none",
    "made-auth OK shared store — only pi-runtime's policy",
  ]);
});

test("[made-auth] avisa de huérfanos vigentes y del store compartido; FAIL si la política no se lee", async () => {
  const { clock, events } = log(true);
  const refusing = { call: async () => ToolRefusal.of(RefusalCode.of("refused"), "nope", false) };
  const checks = await new DiagnoseMadeAuthorization(events, { policies: () => 2 }, STORE, clock).execute(refusing as never);
  assert.deepEqual(lines(checks), [
    "made-auth FAIL host authorization — cannot read the MADE policy as its owner (refused); run underpass setup",
    "made-auth WARN orphan grants — 1 host grants still valid after their session ended; run underpass made revoke-orphans",
    "made-auth WARN shared store — the MADE store holds 2 authorization policies; another installation (e.g. the Claude Code plugin) shares it",
  ]);
  clock.ms += 12 * 3_600_000; // caducado: ya no autoriza nada, no es un aviso
  assert.equal(lines(await new DiagnoseMadeAuthorization(events, { policies: () => null }, STORE, clock).execute(null)).join("\n"), "made-auth OK orphan grants — none");
  const broken = { readAll: () => { throw new Error("disk"); } } as unknown as EventStore;
  assert.deepEqual(lines(await new DiagnoseMadeAuthorization(broken, { policies: () => null }, STORE, clock).execute(null)), ["made-auth WARN orphan grants — event log unreadable (Error)"]);
});

test("el censo lee el store de MADE en sólo lectura y nunca lo crea", () => {
  const dir = mkdtempSync(join(tmpdir(), "made-store-"));
  const census = new SqliteMadePolicyCensus();
  assert.equal(census.policies(StorePath.of(join(dir, "missing.sqlite3"))), null);
  const path = join(dir, "ceremonies.sqlite3");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE authorization_policy_state (policy_id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload BLOB NOT NULL)");
  db.exec("INSERT INTO authorization_policy_state VALUES ('p1', 1, x''), ('p2', 1, x'')");
  db.close();
  assert.equal(census.policies(StorePath.of(path)), 2);
  writeFileSync(join(dir, "other.sqlite3"), "not sqlite");
  assert.equal(census.policies(StorePath.of(join(dir, "other.sqlite3"))), null);
});

test("estado de MADE de una sesión: grants vigentes y confirmaciones", () => {
  const { clock, events } = log(false);
  assert.deepEqual(new ReadMadeStatus(events, clock).execute(S1), { activeGrants: 1, confirmations: 0 });
  assert.deepEqual(new ReadMadeStatus(events, clock).execute(SessionId.of("s2")), { activeGrants: 0, confirmations: 0 });
});
