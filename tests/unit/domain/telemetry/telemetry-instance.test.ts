import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { TelemetryInstanceId } from "../../../../src/domain/telemetry/TelemetryInstanceId.ts";
import { TelemetryKey } from "../../../../src/domain/telemetry/TelemetryKey.ts";

const KEY_HEX = "ab".repeat(32);
const A = ProjectId.of("41ae276521aaee43");
const B = ProjectId.of("0123456789abcdef");

test("clave de telemetría: 32 bytes o 64 hex en minúscula, y nunca se imprime", () => {
  const key = TelemetryKey.of(KEY_HEX);
  assert.equal(key.reveal(), KEY_HEX);
  assert.equal(TelemetryKey.fromBytes(new Uint8Array(32).fill(0xab)).reveal(), KEY_HEX);
  assert.ok(key.equals(TelemetryKey.fromBytes(new Uint8Array(32).fill(0xab))));
  assert.equal(String(key), "[redacted]");
  assert.equal(JSON.stringify({ key }), '{"key":"[redacted]"}');
  assert.equal(`${key}`.includes("ab"), false);
  for (const bad of ["AB".repeat(32), "ab".repeat(31), `${"ab".repeat(32)}0`, "zz".repeat(32), ""]) {
    assert.throws(() => TelemetryKey.of(bad), (e: Error) => e instanceof DomainError && !e.message.includes(bad.slice(0, 8) || "\u0000"), bad);
  }
  assert.throws(() => TelemetryKey.of(42 as never), (e: Error) => e instanceof DomainError && !e.message.includes("42"));
  assert.throws(() => TelemetryKey.fromBytes(new Uint8Array(16)), DomainError);
});

test("id de instancia: HMAC-SHA256(clave, id de proyecto) en 16 hex; estable, distinto por proyecto y distinto del ProjectId", () => {
  const key = TelemetryKey.of(KEY_HEX);
  const a = TelemetryInstanceId.derive(key, A);
  assert.equal(a.value, createHmac("sha256", Buffer.from(KEY_HEX, "hex")).update(A.value).digest("hex").slice(0, 16));
  assert.match(a.value, /^[0-9a-f]{16}$/);
  assert.ok(a.equals(TelemetryInstanceId.derive(TelemetryKey.of(KEY_HEX), A)), "misma clave y proyecto: mismo id");
  assert.notEqual(a.value, A.value, "no es el ProjectId sin sal");
  assert.notEqual(a.value, TelemetryInstanceId.derive(key, B).value, "dos proyectos: dos instancias");
  assert.notEqual(a.value, TelemetryInstanceId.derive(TelemetryKey.of("cd".repeat(32)), A).value, "otra instalación: otro id");
  assert.equal(TelemetryInstanceId.of("0123456789abcdef").value, "0123456789abcdef");
  for (const bad of ["0123", "0123456789ABCDEF", 7 as never]) assert.throws(() => TelemetryInstanceId.of(bad), (e: Error) => e instanceof DomainError && !e.message.includes("0123"));
});
