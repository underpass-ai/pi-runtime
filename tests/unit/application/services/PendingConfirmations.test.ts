import { test } from "node:test";
import assert from "node:assert/strict";
import { PendingConfirmations } from "../../../../src/application/services/PendingConfirmations.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { CallDigest } from "../../../../src/domain/made/CallDigest.ts";
import { MadeAction } from "../../../../src/domain/made/MadeAction.ts";
import { MadeScope } from "../../../../src/domain/made/MadeScope.ts";
import { ToolName } from "../../../../src/domain/mcp/ToolName.ts";
import { ManualClock } from "../../../support/ManualClock.ts";

const S1 = SessionId.of("s1"); const PUBLISH = ToolName.of("made_publish_ceremony_definition");
const ACTION = MadeAction.of("publish_ceremony_definition"); const SCOPE = MadeScope.parse({ kind: "definition", name: "d", version: "1.0" });
let counter = 0;
const entropy = { bytes: (n: number) => new Uint8Array(n).map((_, i) => (i === 0 ? ++counter : 7)) };
const digest = (args: Record<string, unknown>) => CallDigest.of(S1, PUBLISH, args);

test("un token se redime una sola vez, con la misma llamada y antes de 2 minutos", () => {
  const clock = new ManualClock(1_000); const pending = new PendingConfirmations(entropy, clock);
  const a = pending.open(S1, PUBLISH, digest({ y: 1 }), ACTION, SCOPE);
  assert.ok(pending.redeem(a.token, S1, PUBLISH, digest({ y: 1 })) === a);
  assert.equal(pending.redeem(a.token, S1, PUBLISH, digest({ y: 1 })), null, "un solo uso");
  const b = pending.open(S1, PUBLISH, digest({ y: 1 }), ACTION, SCOPE);
  assert.equal(pending.redeem(b.token, S1, PUBLISH, digest({ y: 2 })), null, "otros argumentos");
  assert.equal(pending.redeem(b.token, S1, PUBLISH, digest({ y: 1 })), null, "presentarlo mal lo consume");
  const c = pending.open(S1, PUBLISH, digest({ y: 1 }), ACTION, SCOPE);
  clock.ms += 120_000;
  assert.equal(pending.redeem(c.token, S1, PUBLISH, digest({ y: 1 })), null, "caducado");
});

test("un rechazo se asienta sobre la confirmación de su sesión y la consume", () => {
  const clock = new ManualClock(1_000); const pending = new PendingConfirmations(entropy, clock);
  const a = pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  assert.equal(pending.settle(a.token, SessionId.of("s2")), null);
  const b = pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  assert.ok(pending.settle(b.token, S1) === b);
  assert.equal(pending.settle(b.token, S1), null);
  assert.equal(pending.size(), 0);
});

test("las caducadas se purgan y nunca hay más de 64 pendientes", () => {
  const clock = new ManualClock(1_000); const pending = new PendingConfirmations(entropy, clock);
  const first = pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  for (let i = 0; i < 70; i++) pending.open(S1, PUBLISH, digest({ i }), ACTION, SCOPE);
  assert.equal(pending.size(), 64);
  assert.equal(pending.redeem(first.token, S1, PUBLISH, digest({})), null, "la más antigua salió");
  clock.ms += 120_000;
  pending.open(S1, PUBLISH, digest({}), ACTION, SCOPE);
  assert.equal(pending.size(), 1);
});
