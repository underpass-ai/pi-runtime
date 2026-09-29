import { test } from "node:test";
import assert from "node:assert/strict";
import { PackageInfo } from "../../../src/composition/PackageInfo.ts";
import { TelemetryEnvironment } from "../../../src/composition/TelemetryEnvironment.ts";
import { Project } from "../../../src/domain/project/Project.ts";
import { ProjectRoot } from "../../../src/domain/project/ProjectRoot.ts";

test("configuración y recurso desde las variables OTEL_* del entorno", () => {
  assert.equal(TelemetryEnvironment.configuration({}).state, "disabled");
  const c = TelemetryEnvironment.configuration({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", OTEL_EXPORTER_OTLP_HEADERS: "authorization=x", OTEL_EXPORTER_OTLP_TIMEOUT: "1500" });
  assert.deepEqual([c.state, c.settings?.timeoutMs, c.settings?.headers.names()], ["enabled", 1500, ["authorization"]]);
  assert.equal(TelemetryEnvironment.configuration({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }).state, "invalid");
  const project = Project.of(ProjectRoot.of("/repo"));
  assert.deepEqual(TelemetryEnvironment.resource({ OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=dev,host.name=box" }, project).attributes().toRecord(), {
    "deployment.environment": "dev", "pi_runtime.project": project.id.value, "service.name": "pi-runtime", "service.version": PackageInfo.version(),
  });
  assert.equal(TelemetryEnvironment.resource({ OTEL_RESOURCE_ATTRIBUTES: "=broken" }, project).attributes().get("service.name"), "pi-runtime", "una lista mal formada se ignora entera");
});

test("una configuración inválida explica el motivo sin repetir el endpoint", () => {
  const c = TelemetryEnvironment.configuration({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.internal.example:4318" });
  assert.equal(c.state, "invalid");
  assert.equal(c.settings, null);
  assert.ok(c.problem !== null && c.problem.length > 0);
  assert.equal(c.problem.includes("collector.internal.example"), false);
});
