import { test } from "node:test";
import assert from "node:assert/strict";
import { MetricsCli } from "../../../../../src/adapters/inbound/cli/MetricsCli.ts";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { TelemetryMetricsProjection } from "../../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { ProjectionLag } from "../../../../../src/application/use-cases/ProjectionLag.ts";
import { ReadTelemetryMetrics } from "../../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

function world(project = true) {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o"), fact("tool.completed", "c", { tool: "kmp_ask", server: "kmp", callId: "c", durationMs: 40, status: "succeeded" })], AT);
  const list = [new TelemetryMetricsProjection()];
  if (project) new ProjectionRunner(events, store, list).runOnce();
  const out: string[] = [];
  return { out, cli: new MetricsCli({ read: new ReadTelemetryMetrics(events, store), lag: new ProjectionLag(events, store, list), print: (s) => out.push(s) }) };
}

test("imprime el texto Prometheus del acumulado y, con --session, el de esa sesión", () => {
  const { cli, out } = world();
  assert.equal(cli.run([]), 0);
  assert.match(out.join("\n"), /^pi_runtime_sessions_total\{event="opened"\} 1$/m);
  assert.match(out.join("\n"), /^pi_runtime_tool_duration_ms_bucket\{server="kmp",tool="kmp_ask",le="50"\} 1$/m);
  out.length = 0;
  assert.equal(cli.run(["--session", "s1"]), 0);
  assert.match(out.join("\n"), /^pi_runtime_tool_invocations_total\{server="kmp",status="succeeded",tool="kmp_ask"\} 1$/m);
  out.length = 0;
  assert.equal(cli.run(["--session", "otra"]), 0);
  assert.deepEqual(out, ["# no metrics recorded yet"]);
});

test("proyección atrasada: aviso como comentario; uso incorrecto sale con 2; sesión inválida con 1", () => {
  const { cli, out } = world(false);
  assert.equal(cli.run([]), 0);
  assert.deepEqual(out, ["# projections behind (0/2): start pi in this project or run underpass events rebuild telemetry_metrics"]);
  for (const args of [["x"], ["--session"], ["--session", ""], ["--session", "a", "b"]]) {
    out.length = 0;
    assert.equal(cli.run(args), 2, JSON.stringify(args));
    assert.deepEqual(out, ["usage: underpass metrics [--session <id>]"]);
  }
  out.length = 0;
  assert.equal(cli.run(["--session", "a b"]), 1);
  assert.match(out[0], /^error: invalid session id/);
});
