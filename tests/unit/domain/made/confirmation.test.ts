import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CallDigest } from "../../../../src/domain/made/CallDigest.ts";
import { ConfirmationOutcome } from "../../../../src/domain/made/ConfirmationOutcome.ts";
import { ConfirmationToken } from "../../../../src/domain/made/ConfirmationToken.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { PendingConfirmation } from "../../../../src/domain/made/PendingConfirmation.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

const S1 = SessionId.of("s1"); const PUBLISH = ToolName.of("made_publish_ceremony_definition");

test("el token sale de 16 bytes de entropía y sólo acepta 32 hex", () => {
  const t = ConfirmationToken.fromEntropy(new Uint8Array(16).fill(171));
  assert.equal(t.value, "ab".repeat(16));
  assert.ok(ConfirmationToken.of("ab".repeat(16)).equals(t));
  assert.throws(() => ConfirmationToken.fromEntropy(new Uint8Array(8)), DomainError);
  for (const bad of ["", "AB".repeat(16), "ab".repeat(17), 5 as never]) assert.throws(() => ConfirmationToken.of(bad), DomainError);
});

test("la huella de la llamada depende de sesión, tool y argumentos, no del orden de las claves", () => {
  const a = CallDigest.of(S1, PUBLISH, { definition_yaml: "x", extra: 1 });
  assert.ok(a.equals(CallDigest.of(S1, PUBLISH, { extra: 1, definition_yaml: "x" })));
  assert.ok(!a.equals(CallDigest.of(S1, PUBLISH, { definition_yaml: "y", extra: 1 })));
  assert.ok(!a.equals(CallDigest.of(SessionId.of("s2"), PUBLISH, { definition_yaml: "x", extra: 1 })));
  assert.ok(!a.equals(CallDigest.of(S1, ToolName.of("made_validate_ceremony_draft"), { definition_yaml: "x", extra: 1 })));
  assert.match(a.value, /^[0-9a-f]{64}$/);
});

test("una confirmación pendiente vale 2 minutos y sólo para la misma llamada", () => {
  const now = Timestamp.fromEpochMs(1_000);
  const digest = CallDigest.of(S1, PUBLISH, { definition_yaml: "x" });
  const p = PendingConfirmation.open(ConfirmationToken.of("ab".repeat(16)), S1, PUBLISH, digest, MadeAction.of("publish_ceremony_definition"),
    MadeScope.parse({ kind: "definition", name: "d", version: "1.0" }), now);
  assert.equal(p.expiresAt.epochMs(), 1_000 + PendingConfirmation.TTL_MS);
  assert.equal(PendingConfirmation.TTL_MS, 120_000);
  assert.ok(p.matches(S1, PUBLISH, digest, now));
  assert.ok(!p.matches(S1, PUBLISH, CallDigest.of(S1, PUBLISH, { definition_yaml: "z" }), now));
  assert.ok(!p.matches(SessionId.of("s2"), PUBLISH, digest, now));
  assert.ok(!p.matches(S1, PUBLISH, digest, p.expiresAt));
  assert.equal(p.scopeSummary(), "definition d v1.0");
});

test("resultados de confirmación: la extensión sólo puede comunicar declined o no_ui", () => {
  assert.equal(ConfirmationOutcome.of("accepted"), ConfirmationOutcome.ACCEPTED);
  assert.equal(ConfirmationOutcome.refusal("declined"), ConfirmationOutcome.DECLINED);
  assert.equal(ConfirmationOutcome.refusal("no_ui"), ConfirmationOutcome.NO_UI);
  assert.throws(() => ConfirmationOutcome.refusal("accepted"), DomainError);
  assert.throws(() => ConfirmationOutcome.of("maybe"), DomainError);
});
