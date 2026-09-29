import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../../../../src/application/services/MadeGrantLedger.ts";
import { FactMapper } from "../../../../src/application/mappers/FactMapper.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CallDigest } from "../../../../src/domain/made/CallDigest.ts";
import { ConfirmationOutcome } from "../../../../src/domain/made/ConfirmationOutcome.ts";
import { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeGrant } from "../../../../src/domain/made/MadeGrant.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const HOUR = 3_600_000;
const HOST = Actor.of("host", "host:1");
const DEF = MadeScope.parse({ kind: "definition", name: "d", version: "1.0" });
const at = (ms: number) => Timestamp.fromEpochMs(ms);
const sid = (s: string) => SessionId.of(s);
const opened = (s: string, ms: number) => fact("session.opened", `o.${ms}`, { reason: "startup" }, StreamId.session(sid(s)), ms);
const closed = (s: string, ms: number) => fact("session.closed", `c.${ms}`, { reason: "quit" }, StreamId.session(sid(s)), ms);

function log(clock: ManualClock) {
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock); const facts = new MadeFactFactory(clock, HOST);
  const grant = (s: string, action: string, scope: MadeScope, c: MadeActionClass) => {
    const g = MadeGrant.issue(sid(s), MadeAction.of(action), scope, c, clock.now());
    record.execute(facts.grantIssued(g)); return g;
  };
  return { events, record, facts, grant };
}

test("los hechos de S3a son v1, van a su stream y sólo llevan metadatos", () => {
  const clock = new ManualClock(10_000); const { facts } = log(clock);
  assert.equal(EventType.of("made.grant_issued").belongsToSessions(), true);
  assert.equal(EventType.of("made.confirmation").belongsToSessions(), true);
  assert.equal(EventType.of("made.grant_revoked").belongsToSessions(), false);
  assert.equal(EventType.of("made.grant_issued").madeAudit(), true);
  assert.equal(EventType.of("tools.selected").madeAudit(), false);
  const g = MadeGrant.issue(sid("s1"), MadeAction.of("validate_ceremony_draft"), DEF, MadeActionClass.AUTO, clock.now());
  const issued = facts.grantIssued(g);
  assert.equal(issued.stream.value, "session:s1");
  assert.equal(issued.id.value, `session:s1:made.grant_issued:grant.${g.id.value}`);
  assert.equal(issued.typeVersion.value, 1);
  assert.deepEqual(issued.payload.toValue(), { grantId: g.id.value, action: "validate_ceremony_draft", scope: { kind: "definition", name: "d", version: "1.0" }, validUntil: g.validUntil.value, class: "auto" });
  const revoked = facts.grantRevoked(g.id, sid("s1"), RevocationReason.SESSION_CLOSED);
  assert.equal(revoked.stream.value, "host");
  assert.deepEqual(revoked.payload.toValue(), { grantId: g.id.value, session: "s1", reason: "session_closed" });
  const pending = PendingConfirmation.open(ConfirmationToken.of("ab".repeat(16)), sid("s1"), ToolName.of("made_publish_ceremony_definition"),
    CallDigest.of(sid("s1"), ToolName.of("made_publish_ceremony_definition"), { definition_yaml: "secret yaml" }), MadeAction.of("publish_ceremony_definition"), DEF, clock.now());
  const confirmed = facts.confirmation(pending, ConfirmationOutcome.DECLINED);
  assert.equal(confirmed.id.value, `session:s1:made.confirmation:confirm.${"ab".repeat(16)}`);
  assert.deepEqual(confirmed.payload.toValue(), { action: "publish_ceremony_definition", scopeSummary: "definition d v1.0", outcome: "declined" });
  assert.ok(!confirmed.payload.text.includes("secret"));
  // Sólo el host los registra: Pi no puede enviarlos por `record`.
  for (const type of ["made.grant_issued", "made.confirmation"]) {
    assert.throws(() => new FactMapper().toDomain({ stream: "session", sessionId: "s1", type, typeVersion: 1, about: "x", occurredAtMs: 1, actor: { kind: "agent", id: "pi:1" }, payload: {} }), DomainError, type);
  }
  // Tampoco una revocación falsa en el stream del host, que sacaría un grant vivo de los huérfanos.
  assert.throws(() => new FactMapper().toDomain({ stream: "host", type: "made.grant_revoked", typeVersion: 1, about: `revoke.${g.id.value}`, occurredAtMs: 1, actor: { kind: "agent", id: "pi:1" },
    payload: { grantId: g.id.value, session: "s1", reason: "session_closed" } }), DomainError);
});

test("un grant sólo se registra con la sesión abierta", () => {
  const clock = new ManualClock(10_000); const { grant } = log(clock);
  assert.throws(() => grant("s1", "get_status", MadeScope.GLOBAL, MadeActionClass.AUTO), DomainError);
});

test("el libro: vigentes por sesión, estados, confirmaciones y huérfanos por cierre, abandono o caducidad", () => {
  const clock = new ManualClock(10_000); const { events, record, facts, grant } = log(clock);
  for (const s of ["open", "closed", "idle"]) record.execute(opened(s, 10_000));
  const a = grant("open", "validate_ceremony_draft", DEF, MadeActionClass.AUTO);
  const b = grant("closed", "list_contracts", MadeScope.GLOBAL, MadeActionClass.AUTO);
  const c = grant("idle", "design_ceremony", MadeScope.GLOBAL, MadeActionClass.AUTO);
  clock.ms += 1;
  const d = grant("open", "publish_ceremony_definition", DEF, MadeActionClass.CONFIRM);
  const e = grant("closed", "explain_ceremony_draft", DEF, MadeActionClass.AUTO);
  record.execute(facts.grantRevoked(e.id, sid("closed"), RevocationReason.SESSION_CLOSED));
  record.execute(closed("closed", 10_002));
  const pending = PendingConfirmation.open(ConfirmationToken.of("cd".repeat(16)), sid("open"), ToolName.of("made_publish_ceremony_definition"),
    CallDigest.of(sid("open"), ToolName.of("made_publish_ceremony_definition"), {}), MadeAction.of("publish_ceremony_definition"), DEF, clock.now());
  record.execute(facts.confirmation(pending, ConfirmationOutcome.ACCEPTED));

  const ledger = MadeGrantLedger.read(events);
  const ids = (gs: MadeGrant[]) => gs.map((g) => g.id.value).sort();
  assert.deepEqual(ids(ledger.grants()), ids([a, b, c, d, e]));
  assert.deepEqual(ids(ledger.grants().slice(3)), ids([d, e]), "por instante de emisión");
  assert.equal(ledger.state(e, clock.now()), "revoked");
  assert.equal(ledger.state(a, clock.now()), "active");
  assert.equal(ledger.revocation(e), "session_closed");
  assert.equal(ledger.revocation(a), null);
  assert.deepEqual(ledger.live(sid("open"), clock.now()).map((g) => g.id.value).sort(), [a.id.value, d.id.value].sort());
  assert.equal(ledger.confirmations(sid("open")), 1);
  assert.equal(ledger.confirmations(sid("idle")), 0);
  assert.deepEqual(ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]), [[b.id.value, "session_closed"]]);

  clock.ms += 5 * 60_000; // el grant confirm de 5 min caduca: huérfano por limpieza aunque la sesión siga abierta
  assert.equal(ledger.state(d, clock.now()), "expired");
  assert.deepEqual(ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]).sort(), [[b.id.value, "session_closed"], [d.id.value, "expired_cleanup"]].sort());

  clock.ms = 10_000 + 24 * HOUR; // 24 h sin hechos: las sesiones abiertas están abandonadas
  const all = ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]).sort();
  assert.deepEqual(all, [[a.id.value, "expired_cleanup"], [b.id.value, "session_closed"], [c.id.value, "expired_cleanup"], [d.id.value, "expired_cleanup"]].sort());

  const one = MadeGrantLedger.forSession(events, sid("closed"));
  assert.deepEqual(one.grants().map((g) => g.id.value).sort(), [b.id.value, e.id.value].sort());
  assert.equal(one.state(e, clock.now()), "revoked");
});

test("un payload inesperado se ignora; una sesión reabierta deja de estar cerrada, pero sus grants de antes del cierre siguen huérfanos", () => {
  const clock = new ManualClock(10_000); const { events, record, grant } = log(clock);
  record.execute(opened("s1", 10_000));
  record.execute(fact("made.grant_issued", "grant.bad", { grantId: "nope" }, StreamId.session(sid("s1")), 10_000));
  const g = grant("s1", "get_status", MadeScope.GLOBAL, MadeActionClass.AUTO);
  record.execute(closed("s1", 10_001));
  record.execute(opened("s1", 10_002));
  clock.ms = 10_003;
  const after = grant("s1", "list_contracts", MadeScope.GLOBAL, MadeActionClass.AUTO);
  for (const ledger of [MadeGrantLedger.read(events), MadeGrantLedger.forSession(events, sid("s1"))]) {
    assert.deepEqual(ledger.grants().map((x) => x.id.value), [g.id.value, after.id.value]);
    assert.deepEqual(ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]), [[g.id.value, "session_closed"]], "el emitido tras reabrir sigue vivo");
    assert.deepEqual(ledger.live(sid("s1"), clock.now()).map((x) => x.id.value), [after.id.value], "el de antes del cierre no cuenta como vigente de la sesión reabierta");
  }
});

// Como en L1 y los spans: la auditoría de MADE la registra el host, no es actividad de Pi.
test("un grant emitido tarde no mantiene viva una sesión sin hechos de Pi", () => {
  const clock = new ManualClock(10_000); const { events, record, grant } = log(clock);
  record.execute(opened("s1", 10_000));
  clock.ms += 23 * HOUR;
  const g = grant("s1", "get_status", MadeScope.GLOBAL, MadeActionClass.AUTO);
  clock.ms = 10_000 + 24 * HOUR;
  const ledger = MadeGrantLedger.read(events);
  assert.equal(ledger.state(g, clock.now()), "active", "el grant de 12 h aún no ha caducado");
  assert.deepEqual(ledger.orphans(clock.now()).map((o) => [o.grant.id.value, o.reason.value]), [[g.id.value, "expired_cleanup"]], "la sesión está abandonada");
});

test("F3: instancias arrancadas por la sesión; lector tolerante con payloads inesperados y fines de instancias ajenas", () => {
  const clock = new ManualClock(1_000_000);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  record.execute(opened("s1", clock.ms));
  const stream = StreamId.session(sid("s1"));
  const raw = (type: string, about: string, payload: unknown) => record.execute(fact(type, about, payload, stream, clock.ms));
  raw("made.ceremony_started", "a", { ceremonyId: "c1", definition: "smoke", version: "1.0" });
  raw("made.ceremony_started", "b", { ceremonyId: "" });            // payload inesperado: se ignora
  raw("made.ceremony_started", "c", { ceremonyId: "c1", definition: "other", version: "9" }); // el primero manda
  raw("made.ceremony_ended", "d", { ceremonyId: "nobody", endReason: "completed" }); // no la arrancó: nada
  raw("made.ceremony_ended", "e", { endReason: "completed" });
  const ledger = MadeGrantLedger.forSession(events, sid("s1"));
  assert.deepEqual(ledger.ceremonies(sid("s1")).map((c) => c.summary()), ["ceremony c1 (smoke v1.0)"]);
  const c1 = ledger.ceremonies(sid("s1"))[0].ceremony;
  assert.ok(ledger.running(sid("s1"), c1) !== null);
  assert.equal(ledger.running(sid("s2"), c1), null);
  raw("made.ceremony_ended", "f", { ceremonyId: "c1", endReason: 42 });
  raw("made.ceremony_ended", "g", { ceremonyId: "c1", endReason: "completed" }); // ya terminó: el primero manda
  const after = MadeGrantLedger.read(events);
  assert.equal(after.running(sid("s1"), c1), null);
  assert.equal(after.ceremonies(sid("s1"))[0].end!.value, "unknown");
  assert.deepEqual(after.sessionsWithCeremonies().map(String), ["s1"]);
});
