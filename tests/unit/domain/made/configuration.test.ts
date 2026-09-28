import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { StorePath } from "../../../../src/domain/made/StorePath.ts";
import { PolicyId } from "../../../../src/domain/made/PolicyId.ts";
import { CursorHmacKey } from "../../../../src/domain/made/CursorHmacKey.ts";
import { MadeConfiguration } from "../../../../src/domain/made/MadeConfiguration.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("StorePath exige ruta absoluta y deriva el digest de configuración del plugin", () => {
  const s = StorePath.of("/h/.local/state/underpass-made/ceremonies.sqlite3");
  assert.equal(s.configDigest(), createHash("sha256").update(s.value).digest("hex").slice(0, 16));
  assert.throws(() => StorePath.of("relative/x"), DomainError);
});

test("identidades sin espacios ni =; clave redactada", () => {
  assert.throws(() => PolicyId.of("a b"), DomainError);
  assert.throws(() => PolicyId.of("a=b"), DomainError);
  const key = CursorHmacKey.of("ab".repeat(32));
  assert.equal(String(key), "[redacted]");
  assert.equal(JSON.stringify({ key }), '{"key":"[redacted]"}');
  assert.equal(key.reveal(), "ab".repeat(32));
  assert.throws(() => CursorHmacKey.of("zz"), DomainError);
});

test("generateFor sigue la convención made-local-*-<digest>", () => {
  const s = StorePath.of("/x/ceremonies.sqlite3");
  const c = MadeConfiguration.generateFor(s, new Uint8Array(32).fill(1));
  const d = s.configDigest();
  assert.deepEqual(c.entries().map(([k, v]) => [k, k.endsWith("HMAC_KEY") ? v.length : v]), [
    ["MADE_AUTH_POLICY_ID", `made-local-policy-${d}`],
    ["MADE_AUTH_TRUSTED_HOST_ID", `made-local-host-${d}`],
    ["MADE_CEREMONY_STORE_ID", `made-local-store-${d}`],
    ["MADE_CEREMONY_SEARCH_CURSOR_HMAC_KEY", 64],
  ]);
  assert.throws(() => MadeConfiguration.generateFor(s, new Uint8Array(8)), /32 bytes/);
});

test("PolicyId.of rechaza valores no-string antes de aplicar la regex", () => {
  assert.throws(() => PolicyId.of(undefined as never), DomainError);
});
