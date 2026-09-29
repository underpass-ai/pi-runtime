import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SystemClock } from "../../../src/adapters/outbound/clock/SystemClock.ts";
import { MadeFactFactory } from "../../../src/application/services/MadeFactFactory.ts";
import { RecordFact } from "../../../src/application/use-cases/RecordFact.ts";
import { EventLogComposition } from "../../../src/composition/EventLogComposition.ts";
import { StatePaths } from "../../../src/composition/StatePaths.ts";
import { Actor } from "../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../src/domain/events/StreamId.ts";
import { MadeAction } from "../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../src/domain/made/MadeActionClass.ts";
import { MadeGrant } from "../../../src/domain/made/MadeGrant.ts";
import { MadeScope } from "../../../src/domain/made/MadeScope.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";
import { FakeMade } from "../../support/FakeMade.ts";
import { fact } from "../../support/recordFixtures.ts";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "underpass-made-"));
  const paths = new StatePaths({ HOME: home, XDG_STATE_HOME: join(home, "state") });
  const project = Project.of(ProjectRoot.of(home));
  const out: string[] = [];
  return { home, out, log: paths.eventLogOf(project), composition: new EventLogComposition(paths, project, (s) => out.push(s)) };
}

test("made sin log: grants y revoke-orphans no crean nada ni arrancan MADE", async () => {
  const { home, out, composition } = setup();
  let connects = 0;
  const made = composition.made(async () => { connects++; return new FakeMade(); });
  assert.equal(await made.run(["grants"]), 0);
  assert.equal(await made.run(["revoke-orphans"]), 0);
  assert.deepEqual(out, ["no MADE grants issued by the host", "no orphan MADE grants"]);
  assert.equal(connects, 0);
  assert.equal(existsSync(join(home, "state")), false);
});

test("made con un grant huérfano: grants lo lista, revoke-orphans lo revoca en MADE, lo registra y cierra la conexión", async () => {
  const { out, log, composition } = setup();
  const db = SqliteDatabase.open(log); const events = new SqliteEventStore(db); const clock = new SystemClock();
  const session = StreamId.session(SessionId.of("s1"));
  const record = new RecordFact(events, clock);
  record.execute(fact("session.opened", "o", { reason: "startup" }, session, clock.now().epochMs()));
  const grant = MadeGrant.issue(SessionId.of("s1"), MadeAction.of("list_contracts"), MadeScope.GLOBAL, MadeActionClass.AUTO, clock.now());
  record.execute(new MadeFactFactory(clock, Actor.of("host", "host:1")).grantIssued(grant));
  record.execute(fact("session.closed", "c", { reason: "quit" }, session, clock.now().epochMs()));
  db.close();

  const made = new FakeMade(); let closed = false;
  made.grants.set(grant.id.value, { grant_id: grant.id.value, actions: ["list_contracts"], scope: { kind: "global" }, valid_from: grant.validFrom.value, grantee_id: made.owner, delegation_depth: 0 });
  made.close = async () => { closed = true; };
  const verb = composition.made(async () => made);
  assert.equal(await verb.run(["grants"]), 0);
  assert.match(out[0], new RegExp(`^${grant.id.value}  active   auto     list_contracts  global  until .* session s1$`));
  assert.equal(await verb.run(["revoke-orphans"]), 0);
  assert.equal(out.at(-1), "revoked 1/1 orphan MADE grants");
  assert.ok(made.revoked.has(grant.id.value) && closed);
  const reread = new SqliteEventStore(SqliteDatabase.openReadOnly(log));
  const revoked = reread.readStream(StreamId.HOST).find((r) => r.type.value === "made.grant_revoked")!;
  assert.deepEqual(revoked.payload.toValue(), { grantId: grant.id.value, session: "s1", reason: "session_closed" });
  assert.deepEqual(revoked.actor, Actor.of("human", "underpass-cli"));
  assert.equal(await verb.run(["revoke-orphans"]), 0);
  assert.equal(out.at(-1), "no orphan MADE grants");
});
