import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { ExportResult } from "../../../../src/domain/telemetry/ExportResult.ts";
import { OtelKeyValueList } from "../../../../src/domain/telemetry/OtelKeyValueList.ts";
import { TelemetryResource } from "../../../../src/domain/telemetry/TelemetryResource.ts";

test("resultado de exportación por código HTTP: 2xx ok, 429 y 5xx reintento, el resto se descarta", () => {
  assert.equal(ExportResult.ofStatus(200).kind, "ok");
  assert.equal(ExportResult.ofStatus(204).kind, "ok");
  assert.deepEqual([ExportResult.ofStatus(429).kind, ExportResult.ofStatus(429).reason], ["retryable", "http 429"]);
  assert.equal(ExportResult.ofStatus(503).kind, "retryable");
  assert.deepEqual([ExportResult.ofStatus(400).kind, ExportResult.ofStatus(400).reason], ["rejected", "http 400"]);
  assert.equal(ExportResult.ofStatus(302).kind, "rejected");
  assert.deepEqual([ExportResult.retryable("timeout").kind, ExportResult.rejected("x").kind, ExportResult.ok().reason], ["retryable", "rejected", "ok"]);
});

test("listas k=v de OTEL: percent-decoding, entradas vacías ignoradas y errores sin repetir la entrada", () => {
  const l = OtelKeyValueList.parse(" authorization=Bearer%20abc , x-tenant=acme,, empty= ");
  assert.deepEqual(l.entries(), [["authorization", "Bearer abc"], ["x-tenant", "acme"], ["empty", ""]]);
  assert.deepEqual(l.keys(), ["authorization", "x-tenant", "empty"]);
  assert.equal(l.get("x-tenant"), "acme");
  assert.equal(l.get("nope"), null);
  assert.ok(OtelKeyValueList.parse("").isEmpty());
  assert.ok(OtelKeyValueList.EMPTY.isEmpty());
  for (const bad of ["secret-token-without-key", "=secret", "k=%zzsecret"]) {
    assert.throws(() => OtelKeyValueList.parse(bad), (e: Error) => e instanceof DomainError && !e.message.includes("secret"), bad);
  }
  assert.throws(() => OtelKeyValueList.parse(undefined as never), DomainError);
});

test("recurso: service.name, versión y proyecto con hash; OTEL_RESOURCE_ATTRIBUTES sin máquina, usuario ni rutas", () => {
  const extra = OtelKeyValueList.parse("deployment.environment=dev,host.name=box,process.owner=tirso,user.id=u,os.type=linux,service.name=impostor,team.dir=/home/u,Bad=1,service.namespace=underpass");
  assert.deepEqual(TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"), extra).attributes().toRecord(), {
    "deployment.environment": "dev", "pi_runtime.project": "0123456789abcdef", "service.name": "pi-runtime", "service.namespace": "underpass", "service.version": "0.1.0",
  });
  assert.deepEqual(TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef")).attributes().toRecord(), {
    "pi_runtime.project": "0123456789abcdef", "service.name": "pi-runtime", "service.version": "0.1.0",
  });
});

// R2 (a): una pasada cuyo compare-and-set perdió contra otro escritor.
test("resultado obsoleto (stale): ni éxito ni fallo", () => {
  assert.deepEqual([ExportResult.stale().kind, ExportResult.stale().reason], ["stale", "stale"]);
});

// R2 (c): k8s.*, cloud.*, faas.* y service.instance.id pueden identificar la máquina.
test("recurso: tampoco salen k8s.*, cloud.*, faas.* ni service.instance.id", () => {
  const extra = OtelKeyValueList.parse("k8s.pod.name=p,k8s.node.name=n,cloud.account.id=123,cloud.region=eu,faas.instance=i,service.instance.id=box-1,service.instance.idx=ok,service.namespace=underpass,cloudy.x=y");
  assert.deepEqual(TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"), extra).attributes().toRecord(), {
    "cloudy.x": "y", "pi_runtime.project": "0123456789abcdef", "service.instance.idx": "ok", "service.name": "pi-runtime", "service.namespace": "underpass", "service.version": "0.1.0",
  });
});
