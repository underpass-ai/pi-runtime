import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { StdioMcpConnector } from "../../../../src/adapters/outbound/mcp/StdioMcpConnector.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { IssuedGrants } from "../../../../src/application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { ServerPool } from "../../../../src/application/services/ServerPool.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { DeclineMadeConfirmation } from "../../../../src/application/use-cases/DeclineMadeConfirmation.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { RevokeMadeGrants } from "../../../../src/application/use-cases/RevokeMadeGrants.ts";
import { ServeHostRequest } from "../../../../src/application/use-cases/ServeHostRequest.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeCallContext } from "../../../../src/domain/made/MadeCallContext.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { Project } from "../../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../../src/domain/project/ProjectRoot.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const HOUR = 3_600_000;
const stream = (s: string) => StreamId.session(SessionId.of(s));
const opened = (s: string, ms: number) => fact("session.opened", `o.${ms}`, { reason: "startup" }, stream(s), ms);
const closed = (s: string, ms: number) => fact("session.closed", `c.${ms}`, { reason: "quit" }, stream(s), ms);

// Un host con MADE falso: `grant(s, tool)` concede una lectura en la sesión s como lo haría una llamada real.
function host() {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  const connection = async () => made; const owner = new MadeOwner(connection); const facts = new MadeFactFactory(clock, Actor.of("host", "host:1"));
  const issued = new IssuedGrants(); const lines: string[] = [];
  const log: HostLog = { info: (m, f) => { lines.push(`${m} ${JSON.stringify(f)}`); }, warn: (m, f) => { lines.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} };
  const confirmations = new PendingConfirmations({ bytes: (k) => new Uint8Array(k).fill(1) }, clock);
  const call = new CallMadeTool({ connection, owner, policy: MadeActionPolicy.standard(), confirmations, grants: issued, record, facts, clock, log });
  const revoke = new RevokeMadeGrants(events, owner, record, facts, clock, issued, log);
  const grant = async (s: string, tool: string) => call.execute(ToolName.of(tool), {}, MadeCallContext.of(SessionId.of(s), Phase.DESIGN));
  const revocations = () => events.readStream(StreamId.HOST).filter((r) => r.type.value === "made.grant_revoked").map((r) => r.payload.toValue() as { session: string; reason: string });
  return { clock, made, events, record, facts, confirmations, call, revoke, grant, revocations, lines };
}

test("al cerrar una sesión se revocan sus grants (y sólo los suyos) y se registra cada revocación", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms)); h.record.execute(opened("b", h.clock.ms));
  await h.grant("a", "made_list_contracts"); await h.grant("a", "made_design_ceremony"); await h.grant("b", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  h.made.calls.length = 0;
  assert.deepEqual(await h.revoke.execute(SessionId.of("a")), { orphans: 2, revoked: 2 });
  assert.deepEqual(h.made.calls, ["made_revoke_authorization_grant", "made_revoke_authorization_grant"]);
  assert.equal(h.made.revoked.size, 2);
  assert.deepEqual(h.revocations().map((r) => [r.session, r.reason]), [["a", "session_closed"], ["a", "session_closed"]]);
  assert.deepEqual(await h.revoke.execute(SessionId.of("a")), { orphans: 0, revoked: 0 }, "nada que revocar dos veces");
  assert.match(h.lines.join("\n"), /made grants revoked \{"count":2,"session":"a"\}/);
});

test("al cerrar la sesión la caché se olvida: si se reabre, pide un grant nuevo", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  await h.revoke.execute(SessionId.of("a"));
  h.record.execute(opened("a", h.clock.ms + 1)); h.clock.ms += 2;
  await h.grant("a", "made_list_contracts");
  assert.equal(h.made.grants.size, 2);
});

test("al arrancar: huérfanos por sesión cerrada, abandonada o grant caducado; los vivos se quedan", async () => {
  const h = host();
  for (const s of ["closed", "idle", "live"]) h.record.execute(opened(s, h.clock.ms));
  // MADE no sabe de sesiones: un grant del mismo principal sirve a todas, así que cada una pide otra acción.
  await h.grant("closed", "made_list_contracts"); await h.grant("idle", "made_design_ceremony"); await h.grant("live", "made_diff_ceremony_definitions");
  h.record.execute(closed("closed", h.clock.ms));
  h.clock.ms += 13 * HOUR; // los grants auto (12 h) ya caducaron; la sesión live sigue activa
  h.record.execute(fact("turn.completed", "t", {}, stream("live"), h.clock.ms));
  assert.deepEqual(await h.revoke.execute(), { orphans: 3, revoked: 3 });
  assert.deepEqual(h.revocations().map((r) => [r.session, r.reason]).sort(), [["closed", "session_closed"], ["idle", "expired_cleanup"], ["live", "expired_cleanup"]]);
});

test("sin huérfanos no se toca MADE; si MADE falla, el grant queda para la próxima vez", async () => {
  const h = host();
  assert.deepEqual(await h.revoke.execute(), { orphans: 0, revoked: 0 });
  assert.deepEqual(h.made.calls, []);
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  h.made.failRevoke = true;
  assert.deepEqual(await h.revoke.execute(), { orphans: 1, revoked: 0 });
  assert.match(h.lines.join("\n"), /made grant not revoked .*"reason":"unavailable"/);
  h.made.failRevoke = false;
  assert.deepEqual(await h.revoke.execute(), { orphans: 1, revoked: 1 });
});

test("ServeHostRequest: registrar session.closed revoca los grants de la sesión en segundo plano", async () => {
  const h = host();
  const pool = new ServerPool(Project.of(ProjectRoot.of(process.cwd())), new StdioMcpConnector(2000), new Map());
  const uc = new ServeHostRequest(Project.of(ProjectRoot.of(process.cwd())), pool, h.record, null, null, null,
    { call: h.call, decline: new DeclineMadeConfirmation(h.confirmations, h.record, h.facts), revoke: h.revoke });
  const dto = (type: string, about: string) => ({ stream: "session" as const, sessionId: "a", type, typeVersion: 1, about, occurredAtMs: h.clock.ms, actor: { kind: "agent", id: "pi:1" }, payload: {} });
  await uc.execute({ id: 1, method: "record", fact: dto("session.opened", "o") });
  await uc.execute({ id: 2, method: "call", server: "made", tool: "made_list_contracts", args: {}, sessionId: "a", phase: "design" });
  assert.equal(h.made.grants.size, 1);
  assert.deepEqual(await uc.execute({ id: 3, method: "record", fact: dto("session.closed", "c") }), { id: 3, ok: true, result: { recorded: 1, idempotent: false } });
  const until = Date.now() + 2_000;
  while (h.revocations().length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(h.revocations().map((r) => r.reason), ["session_closed"]);
  assert.equal(h.made.revoked.size, 1);
});

test("una sesión reabierta tras un cierre sin revocar: sus grants de antes del cierre siguen siendo huérfanos", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  h.made.failRevoke = true;
  assert.deepEqual(await h.revoke.execute(SessionId.of("a")), { orphans: 1, revoked: 0 });
  h.made.failRevoke = false;
  h.clock.ms += 1; h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_design_ceremony");
  // Al arrancar, el grant de antes del cierre se revoca aunque la sesión se reabriera; el nuevo sigue vivo.
  assert.deepEqual(await h.revoke.execute(), { orphans: 1, revoked: 1 });
  assert.deepEqual(h.revocations().map((r) => [r.session, r.reason]), [["a", "session_closed"]]);
  // Al volver a cerrarla se revoca todo lo que quedaba vivo de la sesión, esté o no en la caché.
  h.clock.ms += 1; h.record.execute(closed("a", h.clock.ms));
  assert.deepEqual(await h.revoke.execute(SessionId.of("a")), { orphans: 1, revoked: 1 });
  assert.equal(h.made.revoked.size, 2);
});

test("las revocaciones se encadenan: el cierre y el barrido de arranque no revocan dos veces el mismo grant", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  const both = Promise.all([h.revoke.execute(), h.revoke.execute(SessionId.of("a"))]);
  await h.revoke.settled();
  assert.deepEqual(await both, [{ orphans: 1, revoked: 1 }, { orphans: 0, revoked: 0 }]);
  assert.equal(h.revocations().length, 1);
});

test("nunca lanza: un log ilegible o un registro que falla sólo se avisan", async () => {
  const h = host();
  h.record.execute(opened("a", h.clock.ms));
  await h.grant("a", "made_list_contracts");
  h.record.execute(closed("a", h.clock.ms));
  const broken = { ...h.events, readAll: () => { throw new TypeError("disk"); }, readStream: () => { throw new TypeError("disk"); } } as unknown as InMemoryEventStore;
  const unreadable = new RevokeMadeGrants(broken, new MadeOwner(async () => h.made), h.record, h.facts, h.clock, null, { info: () => {}, warn: (m, f) => { h.lines.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} });
  assert.deepEqual(await unreadable.execute(), { orphans: 0, revoked: 0 });
  assert.match(h.lines.join("\n"), /made grants not read \{"reason":"TypeError"\}/);
  const failing = { execute: () => { throw new RangeError("closed"); } } as unknown as RecordFact;
  const unrecorded = new RevokeMadeGrants(h.events, new MadeOwner(async () => h.made), failing, h.facts, h.clock, null, { info: () => {}, warn: (m, f) => { h.lines.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} });
  assert.deepEqual(await unrecorded.execute(SessionId.of("a")), { orphans: 1, revoked: 0 });
  assert.match(h.lines.join("\n"), /made revocation not recorded .*"reason":"RangeError"/);
  // Sin log tampoco lanza.
  assert.deepEqual(await new RevokeMadeGrants(broken, new MadeOwner(async () => h.made), h.record, h.facts, h.clock).execute(), { orphans: 0, revoked: 0 });
});

// Nota de revisión de la tarea 8: `underpass made revoke-orphans` en el proceso del CLI puede
// correr a la vez que el host revoca en el suyo. Son dos `RevokeMadeGrants` sin cadena compartida
// (el `#tail` de cada uno no ve al otro), así que la única defensa es el propio registro: el id del
// hecho `made.grant_revoked` es determinista por grant (MadeFactFactory), y RecordFact ya es
// idempotente para un hecho igual y rechaza (sin romper el barrido) uno que llegara con otro
// contenido. Esto prueba que dos `RevokeMadeGrants` independientes contra el mismo log y el mismo
// MADE, revocando el mismo huérfano a la vez, nunca dejan dos hechos.
test("dos RevokeMadeGrants independientes (como el CLI y el host) revocando el mismo huérfano a la vez: nunca queda un hecho duplicado", async () => {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z")); const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  const connection = async () => made; const facts = new MadeFactFactory(clock, Actor.of("human", "underpass-cli"));
  const issued = new IssuedGrants();
  const call = new CallMadeTool({ connection, owner: new MadeOwner(connection), policy: MadeActionPolicy.standard(), confirmations: new PendingConfirmations({ bytes: (k) => new Uint8Array(k).fill(1) }, clock), grants: issued, record, facts: new MadeFactFactory(clock, Actor.of("host", "host:1")), clock, log: null });
  record.execute(opened("a", clock.ms));
  await call.execute(ToolName.of("made_list_contracts"), {}, MadeCallContext.of(SessionId.of("a"), Phase.DESIGN));
  record.execute(closed("a", clock.ms));

  // Dos instancias distintas: cada una es su propio proceso, con su propia MadeOwner y su propio #tail.
  const cli = new RevokeMadeGrants(events, new MadeOwner(connection), record, facts, clock);
  const host = new RevokeMadeGrants(events, new MadeOwner(connection), record, facts, clock);
  const [a, b] = await Promise.all([cli.execute(), host.execute()]);
  assert.equal(a.orphans + b.orphans >= 1, true);
  assert.equal(a.revoked + b.revoked >= 1, true);
  const revoked = events.readStream(StreamId.HOST).filter((r) => r.type.value === "made.grant_revoked");
  assert.equal(revoked.length, 1, "un solo hecho, nunca duplicado");
  assert.equal(made.revoked.size, 1);
});
