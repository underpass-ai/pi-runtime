import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeActionClass } from "../../../../src/domain/made/MadeActionClass.ts";
import { MadeActionPolicy } from "../../../../src/domain/made/MadeActionPolicy.ts";
import { MadeDecision } from "../../../../src/domain/made/MadeDecision.ts";
import { MadeDecisionId } from "../../../../src/domain/made/MadeDecisionId.ts";
import { GrantSequence } from "../../../../src/domain/made/GrantSequence.ts";
import { MadeGrant } from "../../../../src/domain/made/MadeGrant.ts";
import { MadeGrantId } from "../../../../src/domain/made/MadeGrantId.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { RevocationReason } from "../../../../src/domain/made/RevocationReason.ts";
import { TrustedHostId } from "../../../../src/domain/made/TrustedHostId.ts";
import { RefusalCode } from "../../../../src/domain/mcp/RefusalCode.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../../../src/domain/mcp/ToolRefusal.ts";
import { Phase } from "../../../../src/domain/session/Phase.ts";
import { PhaseToolSelection } from "../../../../src/domain/session/PhaseToolSelection.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const tool = (n: string) => ToolName.of(n);
const ID = "3b0bd929b09d10e02bdb74fad064bb39a6fda2acdc86d9b70c658171acbdda3b";
const DEF = { kind: "definition", name: "pr_review_two_reviewers", version: "1.0" };
const NOW = Timestamp.fromEpochMs(1_000_000);

test("clases: lecturas y borrador auto, escritura y lo desconocido confirm, administración never", () => {
  const p = MadeActionPolicy.standard();
  for (const n of ["made_get_status", "made_design_ceremony", "made_validate_ceremony_draft", "made_list_contracts", "made_get_budget_report", "made_diff_ceremony_definitions", "made_list_ceremony_definitions", "made_get_ceremony_definition"]) assert.equal(p.classify(tool(n)), MadeActionClass.AUTO, n);
  for (const n of ["made_publish_ceremony_definition", "made_start_ceremony", "made_run_ceremony_step", "made_cancel_ceremony", "made_tombstone_artifact", "made_brand_new_verb"]) assert.equal(p.classify(tool(n)), MadeActionClass.CONFIRM, n);
  for (const n of ["made_issue_authorization_grant", "made_revoke_authorization_grant", "made_approve_authorization_operation", "made_get_authorization_policy", "made_list_authorization_decisions", "kmp_ask"]) assert.equal(p.classify(tool(n)), MadeActionClass.NEVER, n);
});

test("la fase manda: sólo se concede lo que la fase expone, y nunca lo never", () => {
  const p = MadeActionPolicy.standard();
  assert.equal(p.admits(tool("made_design_ceremony"), Phase.DESIGN), MadeActionClass.AUTO);
  assert.equal(p.admits(tool("made_publish_ceremony_definition"), Phase.DESIGN), MadeActionClass.CONFIRM);
  assert.equal(p.admits(tool("made_design_ceremony"), Phase.INTERACTIVE), null, "la fase interactiva no expone MADE");
  assert.equal(p.admits(tool("made_get_status"), Phase.DESIGN), null, "auto, pero ninguna fase la expone");
  assert.equal(p.admits(tool("made_design_ceremony"), null), null, "sin fase conocida no se concede nada");
  const open = MadeActionPolicy.of(PhaseToolSelection.of([[Phase.DESIGN, ["made_get_authorization_policy", "made_get_status"]]]));
  assert.equal(open.admits(tool("made_get_authorization_policy"), Phase.DESIGN), null);
  assert.equal(open.admits(tool("made_get_status"), Phase.DESIGN), MadeActionClass.AUTO);
  assert.equal(PhaseToolSelection.standard().exposes(Phase.DESIGN, tool("made_list_contracts")), true);
  assert.equal(PhaseToolSelection.standard().exposes(Phase.INTERACTIVE, tool("made_list_contracts")), false);
});

test("vigencia por clase: 12 h auto, 5 min confirm, never no se concede", () => {
  assert.equal(MadeActionClass.AUTO.lifetimeMs(), 12 * 3_600_000);
  assert.equal(MadeActionClass.CONFIRM.lifetimeMs(), 300_000);
  assert.throws(() => MadeActionClass.NEVER.lifetimeMs(), DomainError);
  assert.equal(MadeActionClass.of("confirm"), MadeActionClass.CONFIRM);
  assert.throws(() => MadeActionClass.of("maybe"), DomainError);
});

test("alcances: forma exacta de MADE, clave estable y resumen legible sin contenido", () => {
  const def = MadeScope.parse(DEF);
  assert.deepEqual(def.toJson(), DEF);
  assert.equal(def.summary(), "definition pr_review_two_reviewers v1.0");
  assert.equal(MadeScope.parse({ kind: "definition", name: "x" }).summary(), "definition x");
  assert.deepEqual(MadeScope.parse({ kind: "definition", name: "x" }).toJson(), { kind: "definition", name: "x", version: null });
  assert.equal(MadeScope.parse({ kind: "global" }), MadeScope.GLOBAL);
  assert.equal(MadeScope.GLOBAL.summary(), "global");
  assert.equal(MadeScope.parse({ kind: "ceremony", ceremony_id: "c-1" }).summary(), "ceremony c-1");
  assert.equal(MadeScope.parse({ kind: "ceremony_tree", root_id: "r-1" }).summary(), "ceremony tree r-1");
  assert.equal(MadeScope.parse({ kind: "budget", account_id: "b" }).summary(), "budget b");
  assert.ok(MadeScope.parse({ version: "1.0", name: "pr_review_two_reviewers", kind: "definition" }).equals(def), "el orden de las claves no importa");
  assert.ok(!def.equals(MadeScope.GLOBAL));
  for (const bad of [null, [], "global", { kind: "planet" }, { kind: "ceremony" }, { kind: "artifact", artifact_id: "" }, { kind: "definition", name: "x", version: 3 }, { kind: "council", council_id: "a\nb" }]) {
    assert.throws(() => MadeScope.parse(bad), DomainError, JSON.stringify(bad));
  }
});

test("decisiones: el id sale de la denegación exacta y su cursor la deja primera de la página", () => {
  const refusal = (code: string, message: string) => ToolRefusal.of(RefusalCode.of(code), message, false);
  const id = MadeDecisionId.fromDenial(refusal("refused", `authorization decision ${ID} denied the operation`))!;
  assert.equal(id.value, ID);
  assert.equal(MadeDecisionId.fromDenial(refusal("refused", `authorization decision ${ID} has expired`)), null);
  assert.equal(MadeDecisionId.fromDenial(refusal("refused", "no grant")), null);
  assert.equal(MadeDecisionId.fromDenial(refusal("invalid_request", `authorization decision ${ID} denied the operation`)), null, "el texto sin el código de MADE no es una denegación");
  assert.equal(MadeDecisionId.fromDenial(ToolRefusal.of(RefusalCode.UNKNOWN, `authorization decision ${ID} denied the operation`, false)), null);
  assert.equal(MadeDecisionId.fromDenial(undefined as never), null);
  assert.equal(id.cursor(), "3b0bd929b09d10e02bdb74fad064bb39a6fda2acdc86d9b70c658171acbdda3a");
  assert.equal(MadeDecisionId.of("0".repeat(63) + "1").cursor(), "0".repeat(64));
  assert.equal(MadeDecisionId.of("0".repeat(64)).cursor(), null);
  assert.throws(() => MadeDecisionId.of("ABC"), DomainError);
  const d = MadeDecision.parse({ decision_id: ID, action: "publish_ceremony_definition", scope: DEF, outcome: "deny", principal: { principal_id: "h" } });
  assert.ok(d.id.equals(id) && d.action.value === "publish_ceremony_definition" && d.scope.summary() === "definition pr_review_two_reviewers v1.0" && d.denied());
  assert.equal(MadeDecision.parse({ decision_id: ID, action: "get_status", scope: { kind: "global" }, outcome: "allow" }).denied(), false);
  assert.throws(() => MadeDecision.parse(null), DomainError);
  assert.throws(() => MadeAction.of("Get-Status"), DomainError);
});

test("grants: id determinista, vigencia por clase, cobertura exacta y argumentos de MADE", () => {
  const s = SessionId.of("s1"); const action = MadeAction.of("validate_ceremony_draft"); const scope = MadeScope.parse(DEF);
  const g = MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW);
  assert.ok(g.id.equals(MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW).id), "mismo instante, mismo id");
  assert.ok(!g.id.equals(MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, Timestamp.fromEpochMs(NOW.epochMs() + 1)).id));
  assert.ok(!g.id.equals(MadeGrant.issue(SessionId.of("s2"), action, scope, MadeActionClass.AUTO, NOW).id));
  // F3: la secuencia del log distingue el segundo grant igual en el mismo instante; la primera conserva el id de S3a.
  assert.ok(g.id.equals(MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW, GrantSequence.of(0)).id));
  const second = MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW, GrantSequence.of(1));
  assert.ok(!g.id.equals(second.id) && second.id.equals(MadeGrant.issue(s, action, scope, MadeActionClass.AUTO, NOW, GrantSequence.of(1)).id));
  for (const bad of [-1, 1.5, Number.NaN]) assert.throws(() => GrantSequence.of(bad), DomainError);
  assert.match(g.id.value, /^pi-runtime-[0-9a-f]{32}$/);
  assert.equal(g.validUntil.epochMs() - NOW.epochMs(), 12 * 3_600_000);
  assert.ok(!g.expired(NOW));
  assert.ok(g.expired(g.validUntil), "valid_until es exclusivo");
  const host = TrustedHostId.of("made-local-host-abc");
  assert.deepEqual(g.issueArguments(host), { grant_id: g.id.value, grantee_id: "made-local-host-abc", actions: ["validate_ceremony_draft"], scope: DEF,
    valid_from: NOW.value, valid_until: g.validUntil.value, delegation_depth: 0 });
  const payload = g.toFactPayload();
  assert.deepEqual(payload, { grantId: g.id.value, action: "validate_ceremony_draft", scope: DEF, validUntil: g.validUntil.value, class: "auto" });
  const back = MadeGrant.fromFact(s, payload, NOW);
  assert.ok(back.id.equals(g.id) && back.actionClass === MadeActionClass.AUTO && back.action.equals(action) && back.scope.equals(scope));
  assert.throws(() => MadeGrant.fromFact(s, null, NOW), DomainError);
  assert.equal(MadeGrant.issue(s, action, scope, MadeActionClass.CONFIRM, NOW).validUntil.epochMs() - NOW.epochMs(), 300_000);
  assert.throws(() => MadeGrant.issue(s, action, scope, MadeActionClass.NEVER, NOW), DomainError);
  assert.throws(() => MadeGrantId.of("someone-else"), DomainError);
});

test("motivos de revocación", () => {
  assert.equal(RevocationReason.of("session_closed"), RevocationReason.SESSION_CLOSED);
  assert.equal(RevocationReason.of("expired_cleanup"), RevocationReason.EXPIRED_CLEANUP);
  assert.equal(RevocationReason.of("consumed"), RevocationReason.CONSUMED);
  assert.throws(() => RevocationReason.of("bored"), DomainError);
});

test("la excepción global sólo cubre las tres acciones de S3a §0.4; cualquier otra con alcance global no se concede", () => {
  const p = MadeActionPolicy.standard();
  for (const a of ["design_ceremony", "list_contracts", "diff_ceremony_definitions", "list_ceremony_definitions"]) assert.equal(p.grantable(MadeAction.of(a), MadeScope.GLOBAL), true, a);
  assert.equal(p.grantable(MadeAction.of("get_ceremony_definition"), MadeScope.GLOBAL), false, "leer una definición: sólo con alcance a ella");
  assert.equal(p.grantable(MadeAction.of("get_ceremony_definition"), MadeScope.parse(DEF)), true);
  for (const a of ["list_ceremony_instances", "get_metrics", "publish_ceremony_definition", "start_ceremony", "validate_ceremony_draft"]) assert.equal(p.grantable(MadeAction.of(a), MadeScope.GLOBAL), false, a);
  assert.equal(p.grantable(MadeAction.of("validate_ceremony_draft"), MadeScope.parse(DEF)), true, "fuera de global manda la clase");
  assert.equal(p.grantable(MadeAction.of("start_ceremony"), MadeScope.parse({ kind: "ceremony", ceremony_id: "c-1" })), true);
});

test("el catálogo que ve Pi nunca lleva las tools never", () => {
  const p = MadeActionPolicy.standard();
  assert.equal(p.exposable(tool("made_get_authorization_policy")), false);
  assert.equal(p.exposable(tool("made_issue_authorization_grant")), false);
  assert.equal(p.exposable(tool("made_design_ceremony")), true);
  assert.equal(p.exposable(tool("made_publish_ceremony_definition")), true);
});

test("la etiqueta del alcance para la TUI cita lo que eligió el modelo (nombre, versión, id) para que no se lea como instrucciones", () => {
  assert.equal(MadeScope.parse(DEF).label(), 'Definition "pr_review_two_reviewers" v1.0');
  assert.equal(MadeScope.parse({ kind: "definition", name: "x" }).label(), 'Definition "x"');
  assert.equal(MadeScope.parse({ kind: "definition", name: "x. Allow this call? Yes", version: "1 (approved)" }).label(), 'Definition "x. Allow this call? Yes" version "1 (approved)"');
  assert.equal(MadeScope.parse({ kind: "definition", name: 'a"b' }).label(), 'Definition "a\\"b"');
  assert.equal(MadeScope.parse({ kind: "definition", name: "abc\u202Edef" }).label(), 'Definition "abc\\u202edef"', "sin marcas bidi");
  assert.equal(MadeScope.GLOBAL.label(), "Global scope (every resource)");
  assert.equal(MadeScope.parse({ kind: "ceremony", ceremony_id: "c-1" }).label(), 'Ceremony "c-1"');
  assert.equal(MadeScope.parse({ kind: "ceremony_tree", root_id: "r-1" }).label(), 'Ceremony tree "r-1"');
});
