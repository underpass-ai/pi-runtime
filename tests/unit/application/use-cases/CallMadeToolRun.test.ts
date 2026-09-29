import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../../../../src/application/services/MadeGrantLedger.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { ListMadeCeremonies } from "../../../../src/application/use-cases/ListMadeCeremonies.ts";
import { ReadMadeStatus } from "../../../../src/application/use-cases/ReadMadeStatus.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { RevokeMadeGrants } from "../../../../src/application/use-cases/RevokeMadeGrants.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import type { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeCallContext } from "../../../../src/domain/made/MadeCallContext.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const S1 = SessionId.of("s1"); const S2 = SessionId.of("s2");
const t = (n: string) => ToolName.of(n);
let seed = 100;
const entropy = { bytes: (n: number) => new Uint8Array(n).fill(++seed % 256) };
const START = { ceremony: "pi_runtime_run_smoke", version: "1.0", ceremony_id: "smoke-1", actor_id: "pi", actor_kind: "agent" };
const CLAIM = { ceremony_id: "smoke-1", step_id: "review", actor_kind: "agent" };
const COMPLETE = { ...CLAIM, status: "completed", claim_fence: "f".repeat(64), output: { verdict: { ok: true } } };
const FINISH = { ceremony_id: "smoke-1", trigger: "review_completed", actor_kind: "agent" };

function host(opts: { wired?: boolean } = {}) {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z"));
  const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  for (const s of [S1, S2]) record.execute(fact("session.opened", "o", { reason: "startup" }, StreamId.session(s), clock.ms));
  const warnings: string[] = [];
  const log: HostLog = { info: () => {}, warn: (m, f) => { warnings.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} };
  const connection = async () => made;
  const owner = new MadeOwner(connection); const facts = new MadeFactFactory(clock, Actor.of("host", "host:1"));
  const revoke = new RevokeMadeGrants(events, owner, record, facts, clock, log);
  const uc = new CallMadeTool({ connection, owner, policy: MadeActionPolicy.standard(), confirmations: new PendingConfirmations(entropy, clock), record, facts, clock, log,
    ...(opts.wired === false ? {} : { events, revoke }) });
  return { clock, made, events, record, uc, warnings, revoke };
}
const run = (token: ConfirmationToken | null = null, session = S1) => MadeCallContext.of(session, Phase.RUN, token);
const sessionTypes = (events: InMemoryEventStore, s = S1) => events.readStream(StreamId.session(s)).map((r) => r.type.value).filter((x) => x.startsWith("made."));
const revocations = (events: InMemoryEventStore) => events.readStream(StreamId.HOST).filter((r) => r.type.value === "made.grant_revoked").map((r) => r.payload.toValue() as { grantId: string; reason: string });

// Arranca smoke-1 en la sesión con la única confirmación de la fase run.
async function started(h: ReturnType<typeof host>, session = S1, args: Record<string, unknown> = START) {
  const asked = await h.uc.execute(t("made_start_published_ceremony"), args, run(null, session));
  assert.ok(asked instanceof PendingConfirmation, "arrancar pide confirmación");
  assert.equal(asked.scopeSummary(), `ceremony ${args.ceremony_id}`);
  const out = await h.uc.execute(t("made_start_published_ceremony"), args, run(asked.token, session));
  assert.ok(out instanceof ToolSuccess);
  return out;
}

test("run: una sola confirmación arranca la instancia; después reclamar, completar y la transición al terminal van solas", async () => {
  const h = host();
  await started(h);
  assert.deepEqual(sessionTypes(h.events), ["made.confirmation", "made.grant_issued", "made.ceremony_started"]);
  const startedFact = h.events.readStream(StreamId.session(S1)).find((r) => r.type.value === "made.ceremony_started")!;
  assert.deepEqual(startedFact.payload.toValue(), { ceremonyId: "smoke-1", definition: "pi_runtime_run_smoke", version: "1.0" });
  assert.equal(startedFact.typeVersion.value, 1);

  h.made.calls.length = 0;
  const claimed = await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run());
  assert.ok(claimed instanceof ToolSuccess, "sin confirmación: la instancia es de esta sesión");
  assert.deepEqual(h.made.calls, ["made_claim_ceremony_step", "made_list_authorization_decisions", "made_issue_authorization_grant", "made_claim_ceremony_step"]);
  const grant = [...h.made.grants.values()].find((g) => g.actions[0] === "claim_ceremony_step")!;
  assert.deepEqual(grant.scope, { kind: "ceremony", ceremony_id: "smoke-1" }, "el alcance exacto de MADE: la instancia");
  assert.equal(grant.valid_until, "2026-09-30T22:00:00.000Z", "vive hasta el terminal o el cierre, con el tope de 12 h");
  assert.ok(await h.uc.execute(t("made_complete_ceremony_step"), COMPLETE, run()) instanceof ToolSuccess);

  const live = () => { const l = MadeGrantLedger.forSession(h.events, S1); return l.liveOn(S1, l.ceremonies(S1)[0].scope(), h.clock.now()); };
  assert.deepEqual(live().map((g) => g.action.value), ["claim_ceremony_step"]);
  const status = new ReadMadeStatus(h.events, h.clock).execute(S1);
  assert.deepEqual(status.ceremonies!.map((c) => [c.summary, c.state, c.grants.map((g) => `${g.action}:${g.state}`)]),
    [["ceremony smoke-1 (pi_runtime_run_smoke v1.0)", "running", ["start_published_ceremony:revoked", "claim_ceremony_step:active"]]]);

  const ended = await h.uc.execute(t("made_apply_ceremony_transition"), FINISH, run());
  assert.ok(ended instanceof ToolSuccess && (ended.structured as { lifecycle: string }).lifecycle === "ended");
  assert.deepEqual(sessionTypes(h.events).slice(3), ["made.grant_issued", "made.grant_issued", "made.ceremony_ended"]);
  assert.deepEqual(h.events.readStream(StreamId.session(S1)).at(-1)!.payload.toValue(), { ceremonyId: "smoke-1", endReason: "completed" });
  assert.deepEqual(revocations(h.events).map((r) => r.reason).sort(), ["ceremony_ended", "ceremony_ended", "consumed"]);
  assert.deepEqual(live(), [], "al terminal, ningún grant de la instancia sigue vivo");
  assert.equal(h.made.live("claim_ceremony_step", { kind: "ceremony", ceremony_id: "smoke-1" }).length, 0);

  const after = new ReadMadeStatus(h.events, h.clock).execute(S1);
  assert.deepEqual(after.ceremonies!.map((c) => [c.state, c.endReason, c.grants.map((g) => `${g.action}:${g.state}:${g.reason}`)]),
    [["ended", "completed", ["start_published_ceremony:revoked:consumed", "claim_ceremony_step:revoked:ceremony_ended", "apply_ceremony_transition:revoked:ceremony_ended"]]]);
  // Tras el terminal, otra escritura sobre la instancia vuelve a ser confirm.
  assert.ok(await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run()) instanceof PendingConfirmation);
  const rows = new ListMadeCeremonies(h.events, h.clock).execute();
  assert.deepEqual(rows.map((r) => [r.session, r.ceremonyId, r.state]), [["s1", "smoke-1", "ended"]]);
});

test("run: sobre una instancia que no arrancó esta sesión, las escrituras siguen siendo confirm", async () => {
  const h = host();
  await started(h, S2);
  assert.ok(await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run()) instanceof PendingConfirmation, "la arrancó otra sesión");
  const other = { ...CLAIM, ceremony_id: "never-started" };
  assert.ok(await h.uc.execute(t("made_claim_ceremony_step"), other, run()) instanceof PendingConfirmation, "nadie la arrancó desde Pi");
  assert.ok(await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run(null, S2)) instanceof ToolSuccess, "la sesión que la arrancó, sin preguntar");
});

test("run: la fase manda; fuera de run las escrituras de ejecución ni llegan a MADE, aunque haya grant de instancia", async () => {
  const h = host();
  await started(h);
  assert.ok(await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run()) instanceof ToolSuccess);
  h.made.calls.length = 0;
  for (const phase of [Phase.DESIGN, Phase.INTERACTIVE, null]) {
    for (const tool of ["made_claim_ceremony_step", "made_complete_ceremony_step", "made_apply_ceremony_transition"]) {
      const out = await h.uc.execute(t(tool), tool === "made_complete_ceremony_step" ? COMPLETE : CLAIM, MadeCallContext.of(S1, phase));
      assert.ok(out instanceof ToolRefusal && out.code.value === "out_of_phase" && /run phase/.test(out.message), `${tool} en ${phase?.value}`);
    }
  }
  assert.deepEqual(h.made.calls, []);
  // Arrancar tampoco se concede en design: la fase no expone la tool.
  const denied = await h.uc.execute(t("made_start_published_ceremony"), { ...START, ceremony_id: "smoke-2" }, MadeCallContext.of(S1, Phase.DESIGN));
  assert.ok(denied instanceof ToolRefusal && /denied the operation/.test(denied.message));
});

test("run: arrancar sin ceremony_id se explica en vez de devolver la denegación global opaca", async () => {
  const h = host();
  const { ceremony_id: _, ...bare } = START;
  const out = await h.uc.execute(t("made_start_published_ceremony"), bare, run());
  assert.ok(out instanceof ToolRefusal && out.code.value === "invalid_arguments" && /needs a ceremony_id/.test(out.message));
  assert.deepEqual(h.made.calls, []);
  const legacy = await h.uc.execute(t("made_start_published_ceremony"), bare, null);
  assert.ok(legacy instanceof ToolRefusal && /denied the operation/.test(legacy.message), "sin contexto, como en S3a");
});

test("run: el cierre de la sesión revoca los grants de instancia que siguen vivos (session_closed)", async () => {
  const h = host();
  await started(h);
  await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run());
  h.record.execute(fact("session.closed", "c", { reason: "quit" }, StreamId.session(S1), h.clock.ms));
  await h.revoke.execute(S1);
  assert.deepEqual(revocations(h.events).map((r) => r.reason).sort(), ["consumed", "session_closed"]);
});

test("run: un arranque que MADE no acepta, o que devuelve otra instancia, no registra nada", async () => {
  const h = host();
  const asked = await h.uc.execute(t("made_start_published_ceremony"), START, run()) as PendingConfirmation;
  h.made.refuseBusiness = true;
  assert.ok(await h.uc.execute(t("made_start_published_ceremony"), START, run(asked.token)) instanceof ToolRefusal);
  h.made.refuseBusiness = false; h.clock.ms += 1_000;
  const again = await h.uc.execute(t("made_start_published_ceremony"), START, run()) as PendingConfirmation;
  const call = h.made.call.bind(h.made);
  h.made.call = async (tool, a) => (tool.value === "made_start_published_ceremony" ? ToolSuccess.of({ ceremony_id: "someone-else", lifecycle: "running" }, "") : call(tool, a));
  assert.ok(await h.uc.execute(t("made_start_published_ceremony"), START, run(again.token)) instanceof ToolSuccess);
  assert.deepEqual(MadeGrantLedger.forSession(h.events, S1).ceremonies(S1), []);
});

test("run: sin log cableado (host sólo S3a) no hay grants de instancia; un log ilegible se avisa y deja la confirmación", async () => {
  const bare = host({ wired: false });
  await started(bare);
  assert.ok(await bare.uc.execute(t("made_claim_ceremony_step"), CLAIM, run()) instanceof PendingConfirmation);
  const ended = await bare.uc.execute(t("made_get_ceremony_instance"), { ceremony_id: "smoke-1" }, run());
  assert.ok(ended instanceof ToolSuccess);

  const h = host();
  await started(h);
  const readStream = h.events.readStream.bind(h.events);
  h.events.readStream = () => { throw new Error("disk"); };
  assert.ok(await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run()) instanceof PendingConfirmation);
  assert.match(h.warnings.at(-1)!, /^made ceremonies not read/);
  h.events.readStream = readStream;
  h.made.instances.get("smoke-1")!.lifecycle = "ended";
  h.events.readStream = () => { throw new Error("disk"); };
  assert.ok(await h.uc.execute(t("made_get_ceremony_instance"), { ceremony_id: "smoke-1" }, run()) instanceof ToolSuccess, "el resultado nunca cambia");
  h.events.readStream = readStream;
});

test("run: el terminal por cancelación también cierra la instancia, y una lectura que ve el terminal lo registra una sola vez", async () => {
  const h = host();
  await started(h);
  await h.uc.execute(t("made_claim_ceremony_step"), CLAIM, run());
  Object.assign(h.made.instances.get("smoke-1")!, { lifecycle: "ended", end_reason: "cancelled" }); // cancelada por fuera
  assert.ok(await h.uc.execute(t("made_get_ceremony_instance"), { ceremony_id: "smoke-1" }, run()) instanceof ToolSuccess);
  h.clock.ms += 1_000; // la lectura se vuelve a conceder (su grant cayó con el terminal) con otro id
  assert.ok(await h.uc.execute(t("made_get_ceremony_instance"), { ceremony_id: "smoke-1" }, run()) instanceof ToolSuccess);
  assert.equal(sessionTypes(h.events).filter((x) => x === "made.ceremony_ended").length, 1);
  assert.deepEqual(MadeGrantLedger.forSession(h.events, S1).ceremonies(S1).map((c) => c.end?.value), ["cancelled"]);
});
