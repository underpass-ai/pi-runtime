import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { IssuedGrants } from "../../../../src/application/services/IssuedGrants.ts";
import { MadeFactFactory } from "../../../../src/application/services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../../../../src/application/services/MadeGrantLedger.ts";
import { MadeOwner } from "../../../../src/application/services/MadeOwner.ts";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { CallMadeTool } from "../../../../src/application/use-cases/CallMadeTool.ts";
import { RecordFact } from "../../../../src/application/use-cases/RecordFact.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeCallContext } from "../../../../src/domain/made/MadeCallContext.ts";
import { MadeDecisionId } from "../../../../src/domain/made/MadeDecisionId.ts";
import { MadeGrantId } from "../../../../src/domain/made/MadeGrantId.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../../../src/domain/mcp/ToolSuccess.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { FakeMade } from "../../../support/FakeMade.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { fact } from "../../../support/recordFixtures.ts";

const S1 = SessionId.of("s1");
const YAML = "name: pr_review_two_reviewers\nversion: \"1.0\"\n";
const t = (n: string) => ToolName.of(n);
let seed = 0;
const entropy = { bytes: (n: number) => new Uint8Array(n).fill(++seed % 256) };

function host(opts: { open?: boolean } = {}) {
  const clock = new ManualClock(Date.parse("2026-09-30T10:00:00.000Z"));
  const made = new FakeMade(() => clock.ms);
  const events = new InMemoryEventStore(); const record = new RecordFact(events, clock);
  if (opts.open !== false) record.execute(fact("session.opened", "o", { reason: "startup" }, StreamId.session(S1), clock.ms));
  const warnings: string[] = [];
  const log: HostLog = { info: () => {}, warn: (m, f) => { warnings.push(`${m} ${JSON.stringify(f)}`); }, error: () => {} };
  const connection = async () => made;
  const confirmations = new PendingConfirmations(entropy, clock);
  const uc = new CallMadeTool({ connection, owner: new MadeOwner(connection), policy: MadeActionPolicy.standard(), confirmations, grants: new IssuedGrants(),
    record, facts: new MadeFactFactory(clock, Actor.of("host", "host:1")), clock, log });
  return { clock, made, events, uc, warnings, confirmations };
}
const design = (token: ConfirmationToken | null = null) => MadeCallContext.of(S1, Phase.DESIGN, token);
const madeTypes = (events: InMemoryEventStore) => events.readStream(StreamId.session(S1)).map((r) => r.type.value).filter((x) => x.startsWith("made."));

test("auto: una lectura denegada se concede sola con un grant exacto de 12 h y un único reintento", async () => {
  const h = host();
  const out = await h.uc.execute(t("made_validate_ceremony_draft"), { definition_yaml: YAML }, design());
  assert.ok(out instanceof ToolSuccess);
  assert.deepEqual(h.made.calls, ["made_validate_ceremony_draft", "made_list_authorization_decisions", "made_get_authorization_policy", "made_issue_authorization_grant", "made_validate_ceremony_draft"]);
  const [grant] = [...h.made.grants.values()];
  assert.deepEqual({ ...grant, grant_id: "x" }, { grant_id: "x", grantee_id: h.made.owner, actions: ["validate_ceremony_draft"], scope: { kind: "definition", name: "pr_review_two_reviewers", version: "1.0" },
    valid_from: "2026-09-30T10:00:00.000Z", valid_until: "2026-09-30T22:00:00.000Z", delegation_depth: 0 });
  assert.equal(madeTypes(h.events).join(), "made.grant_issued");
  assert.deepEqual(MadeGrantLedger.read(h.events).live(S1, h.clock.now()).map((g) => g.id.value), [grant.grant_id]);

  h.made.calls.length = 0; // la caché: con el grant vivo, otra lectura igual no emite nada
  assert.ok(await h.uc.execute(t("made_validate_ceremony_draft"), { definition_yaml: YAML }, design()) instanceof ToolSuccess);
  assert.deepEqual(h.made.calls, ["made_validate_ceremony_draft"]);
});

test("caché: si MADE deniega con un grant del host vigente en caché, no se emite otro y se reintenta una vez", async () => {
  const h = host();
  await h.uc.execute(t("made_list_contracts"), {}, design());
  h.made.revoked.add([...h.made.grants.keys()][0]); // alguien lo revocó por fuera
  h.made.calls.length = 0;
  const out = await h.uc.execute(t("made_list_contracts"), {}, design());
  assert.ok(out instanceof ToolRefusal && MadeDecisionId.fromDenial(out.message) !== null, "la segunda denegación vuelve tal cual");
  assert.deepEqual(h.made.calls, ["made_list_contracts", "made_list_authorization_decisions", "made_list_contracts"]);
  assert.equal(h.made.grants.size, 1);
});

test("dos llamadas denegadas a la vez comparten una sola emisión", async () => {
  const h = host();
  const [a, b] = await Promise.all([h.uc.execute(t("made_list_contracts"), {}, design()), h.uc.execute(t("made_list_contracts"), {}, design())]);
  assert.ok(a instanceof ToolSuccess && b instanceof ToolSuccess);
  assert.equal(h.made.grants.size, 1);
});

test("sin contexto, fuera de fase, never, otra negativa o decisión ilegible: la denegación original", async () => {
  const h = host();
  const denied = (o: unknown) => o instanceof ToolRefusal && MadeDecisionId.fromDenial(o.message) !== null;
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, null)), "extensión anterior: sin sesión ni fase");
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, MadeCallContext.of(S1, Phase.INTERACTIVE))), "la fase no la expone");
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, MadeCallContext.of(S1, null))), "fase desconocida");
  assert.ok(denied(await h.uc.execute(t("made_get_status"), {}, design())), "auto, pero ninguna fase la expone");
  h.made.failDecisions = true;
  assert.ok(denied(await h.uc.execute(t("made_list_contracts"), {}, design())), "la decisión no se pudo leer");
  h.made.failDecisions = false;
  assert.equal(h.made.grants.size, 0);
  assert.deepEqual(madeTypes(h.events), []);
  assert.deepEqual(await h.uc.execute(t("made_list_contracts"), {}, design()) instanceof ToolSuccess, true);
});

test("si la emisión falla se devuelve la denegación original y se avisa sin argumentos", async () => {
  const h = host();
  h.made.failIssue = true;
  const out = await h.uc.execute(t("made_validate_ceremony_draft"), { definition_yaml: YAML }, design());
  assert.ok(out instanceof ToolRefusal && /denied the operation/.test(out.message));
  assert.deepEqual(h.warnings, ["made grant not issued {\"action\":\"validate_ceremony_draft\",\"reason\":\"unavailable\"}"]);
  assert.equal(h.made.calls.filter((c) => c === "made_validate_ceremony_draft").length, 1, "sin grant no hay reintento");
});

test("sin la sesión abierta en el log el grant se revoca en el acto y no se usa", async () => {
  const h = host({ open: false });
  const out = await h.uc.execute(t("made_list_contracts"), {}, design());
  assert.ok(out instanceof ToolRefusal);
  assert.equal(h.made.grants.size, 1);
  assert.deepEqual([...h.made.revoked], [...h.made.grants.keys()]);
  assert.match(h.warnings[0], /^made grant not issued .*"reason":"DomainError"/);
});

test("confirm: sin token pide confirmación; con el token emite un grant de 5 min, registra la aceptación y llama", async () => {
  const h = host();
  const args = { definition_yaml: YAML };
  const asked = await h.uc.execute(t("made_publish_ceremony_definition"), args, design());
  assert.ok(asked instanceof PendingConfirmation);
  assert.equal(asked.action.value, "publish_ceremony_definition");
  assert.equal(asked.scopeSummary(), "definition pr_review_two_reviewers v1.0");
  assert.equal(h.made.grants.size, 0);

  h.made.calls.length = 0;
  const done = await h.uc.execute(t("made_publish_ceremony_definition"), args, design(asked.token));
  assert.ok(done instanceof ToolSuccess);
  assert.deepEqual(h.made.calls, ["made_get_authorization_policy", "made_issue_authorization_grant", "made_publish_ceremony_definition"]);
  const [grant] = [...h.made.grants.values()];
  assert.equal(Date.parse(grant.valid_until!) - Date.parse(grant.valid_from), 300_000);
  assert.deepEqual(madeTypes(h.events), ["made.confirmation", "made.grant_issued"]);
  const confirmation = h.events.readStream(StreamId.session(S1)).find((r) => r.type.value === "made.confirmation")!;
  assert.deepEqual(confirmation.payload.toValue(), { action: "publish_ceremony_definition", scopeSummary: "definition pr_review_two_reviewers v1.0", outcome: "accepted" });
  assert.ok(!confirmation.payload.text.includes("version: "), "nunca el YAML");

  const again = await h.uc.execute(t("made_publish_ceremony_definition"), args, design(asked.token));
  assert.ok(again instanceof ToolSuccess, "el grant de 5 min sigue vivo");
  assert.equal(madeTypes(h.events).filter((x) => x === "made.confirmation").length, 1, "el token ya no vale: no hay otra aceptación");
});

test("confirm: un token de otra llamada o caducado no concede nada y vuelve a pedir confirmación", async () => {
  const h = host();
  const asked = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design()) as PendingConfirmation;
  const other = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: `${YAML}# otra\n` }, design(asked.token));
  assert.ok(other instanceof PendingConfirmation && !other.token.equals(asked.token));
  const late = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design()) as PendingConfirmation;
  h.clock.ms += 120_000;
  assert.ok(await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design(late.token)) instanceof PendingConfirmation);
  assert.equal(h.made.grants.size, 0);
});

test("confirm: si la emisión con token falla, la llamada sigue y MADE la deniega (sin bucle)", async () => {
  const h = host();
  const asked = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design()) as PendingConfirmation;
  h.made.failIssue = true;
  const out = await h.uc.execute(t("made_publish_ceremony_definition"), { definition_yaml: YAML }, design(asked.token));
  assert.ok(out instanceof ToolRefusal && /denied the operation/.test(out.message));
  assert.equal(h.warnings.length, 1);
});

test("MadeOwner: revocar dos veces o un grant desconocido no falla; otra negativa sí", async () => {
  const h = host();
  const owner = new MadeOwner(async () => h.made);
  await h.uc.execute(t("made_list_contracts"), {}, design());
  const id = MadeGrantId.of([...h.made.grants.keys()][0]);
  await owner.revoke(id, RevocationReason.SESSION_CLOSED);
  await owner.revoke(id, RevocationReason.SESSION_CLOSED);
  await owner.revoke(MadeGrantId.of(`pi-runtime-${"0".repeat(32)}`), RevocationReason.EXPIRED_CLEANUP);
  assert.deepEqual([...h.made.revoked], [id.value]);
  const broken = new MadeOwner(async () => ({ call: async () => ToolRefusal.of(RefusalCode.of("unavailable"), "boom", false) }) as never);
  await assert.rejects(broken.revoke(id, RevocationReason.SESSION_CLOSED));
  assert.equal(await broken.decision(MadeDecisionId.of("a".repeat(64))), null);
});
