import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { OtlpConfiguration } from "../../../../src/domain/telemetry/OtlpConfiguration.ts";
import { OtlpEndpoint } from "../../../../src/domain/telemetry/OtlpEndpoint.ts";
import { OtlpHeaders } from "../../../../src/domain/telemetry/OtlpHeaders.ts";
import { OtlpSettings } from "../../../../src/domain/telemetry/OtlpSettings.ts";

test("endpoint: https, o http sólo en localhost, 127.0.0.1 o [::1]; sin credenciales, query ni fragmento", () => {
  assert.equal(OtlpEndpoint.of("https://otel.example.com:4318/").signalUrl("traces"), "https://otel.example.com:4318/v1/traces");
  assert.equal(OtlpEndpoint.of("http://localhost:4318").signalUrl("metrics"), "http://localhost:4318/v1/metrics");
  assert.equal(OtlpEndpoint.of("http://127.0.0.1:4318/base").signalUrl("traces"), "http://127.0.0.1:4318/base/v1/traces");
  assert.ok(OtlpEndpoint.of("http://[::1]:4318").isLocal());
  assert.equal(OtlpEndpoint.of("https://otel.example.com").describe(), "https");
  assert.equal(OtlpEndpoint.of("http://localhost:4318").describe(), "localhost");
  for (const bad of ["http://otel.example.com:4318", "ftp://localhost", "not a url", "https://user:pw@otel.example.com", "https://otel.example.com?x=1", "https://otel.example.com#f"]) {
    assert.throws(() => OtlpEndpoint.of(bad), (e: Error) => e instanceof DomainError && !/otel\.example\.com/.test(e.message) && !e.message.includes("pw"), bad);
  }
  assert.throws(() => OtlpEndpoint.of(undefined as never), DomainError);
});

test("cabeceras: nombres en minúscula; los valores sólo para el adaptador HTTP, nunca en texto", () => {
  const h = OtlpHeaders.parse("Authorization=Bearer%20s3cr3t,X-Tenant=acme,content-type=text/plain");
  assert.deepEqual(h.names(), ["authorization", "x-tenant"]);
  assert.deepEqual(h.toRecord(), { authorization: "Bearer s3cr3t", "x-tenant": "acme" });
  assert.equal(String(h), "OtlpHeaders(authorization, x-tenant)");
  assert.equal(JSON.stringify({ h }), '{"h":["authorization","x-tenant"]}');
  assert.throws(() => OtlpHeaders.parse("bad name=s3cr3t"), (e: Error) => e instanceof DomainError && !e.message.includes("s3cr3t"));
  assert.throws(() => OtlpHeaders.parse("a=s3cr3t%0Ay"), (e: Error) => e instanceof DomainError && !e.message.includes("s3cr3t"));
  assert.deepEqual(OtlpHeaders.NONE.names(), []);
});

test("configuración desde el entorno: desactivada sin endpoint, inválida sin repetir la entrada, timeout de 10 s por defecto", () => {
  assert.equal(OtlpConfiguration.fromEnvironment({}).state, "disabled");
  assert.equal(OtlpConfiguration.fromEnvironment({ endpoint: "  " }).state, "disabled");
  assert.equal(OtlpConfiguration.DISABLED.settings, null);
  const ok = OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", headers: "authorization=t0k3n" });
  assert.equal(ok.state, "enabled");
  assert.equal(ok.settings?.timeoutMs, OtlpSettings.DEFAULT_TIMEOUT_MS);
  assert.equal(OtlpSettings.DEFAULT_TIMEOUT_MS, 10_000);
  assert.deepEqual(ok.settings?.headers.names(), ["authorization"]);
  assert.equal(OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", timeout: "2500" }).settings?.timeoutMs, 2500);
  for (const env of [{ endpoint: "http://collector.internal:4318" }, { endpoint: "http://localhost:4318", headers: "t0k3n" }, { endpoint: "http://localhost:4318", timeout: "soon" }, { endpoint: "http://localhost:4318", timeout: "0" }]) {
    const c = OtlpConfiguration.fromEnvironment(env);
    assert.equal(c.state, "invalid");
    assert.equal(c.settings, null);
    assert.ok(c.problem !== null && !c.problem.includes("collector.internal") && !c.problem.includes("t0k3n"), c.problem ?? "");
  }
  assert.throws(() => OtlpSettings.of(OtlpEndpoint.of("http://localhost:1"), OtlpHeaders.NONE, 700_000), DomainError);
});

test("el endpoint nunca se muestra como texto: String y JSON sólo dicen https o localhost", () => {
  const e = OtlpEndpoint.of("https://otel.example.com:4318/base");
  assert.equal(String(e), "OtlpEndpoint(https)");
  assert.equal(JSON.stringify({ e }), '{"e":"https"}');
  assert.equal(String(OtlpEndpoint.of("http://127.0.0.1:4318")), "OtlpEndpoint(localhost)");
  for (const bad of ["http://localhost.otel.example.com", "http://127.0.0.1.otel.example.com", "https://pw@otel.example.com"]) {
    assert.throws(() => OtlpEndpoint.of(bad), (e: Error) => e instanceof DomainError && !/otel\.example\.com/.test(e.message) && !e.message.includes("pw"), bad);
  }
});

test("cabeceras: un valor que fetch no aceptaría se rechaza en la configuración sin repetirlo", () => {
  for (const raw of ["a=s3cr3t%00", "a=s3cr3t%E2%82%AC", "a=s3cr3t%0D"]) {
    assert.throws(() => OtlpHeaders.parse(raw), (e: Error) => e instanceof DomainError && !e.message.includes("s3cr3t"), raw);
  }
  assert.throws(() => OtlpHeaders.parse("a=%E0%A4%A"), (e: Error) => e instanceof DomainError);
  assert.deepEqual(OtlpHeaders.parse("a=caf%C3%A9 \tok").toRecord(), { a: "café \tok" });
  const c = OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", headers: "authorization=s3cr3t%E2%82%AC" });
  assert.equal(c.state, "invalid");
  assert.ok(c.problem !== null && !c.problem.includes("s3cr3t"));
});

test("cabeceras: las que fetch prohíbe y las repetidas (sin distinguir mayúsculas) son configuración inválida, nombrando sólo la cabecera", () => {
  for (const name of ["Connection", "transfer-encoding", "keep-alive", "upgrade", "content-length", "expect", "host", "te", "trailer", "proxy-authorization", "Proxy-Connection"]) {
    assert.throws(() => OtlpHeaders.parse(`${name}=s3cr3t`), (e: Error) => e instanceof DomainError && e.message.includes(name.toLowerCase()) && !e.message.includes("s3cr3t"), name);
  }
  for (const raw of ["Authorization=s3cr3t,authorization=0th3r", "a=s3cr3t,a=0th3r", " a =s3cr3t,A=0th3r"]) {
    assert.throws(() => OtlpHeaders.parse(raw), (e: Error) => e instanceof DomainError && !e.message.includes("s3cr3t") && !e.message.includes("0th3r"), raw);
  }
  assert.deepEqual(OtlpHeaders.parse("x-proxied=1,tenant=2").names(), ["tenant", "x-proxied"]);
  assert.equal(OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", headers: "host=s3cr3t" }).state, "invalid");
});
