import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { QualityKpisProjection } from "../../../../src/application/projections/QualityKpisProjection.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { DiagnoseTelemetry } from "../../../../src/application/use-cases/DiagnoseTelemetry.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../../src/domain/events/ProjectionCursor.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { OtlpConfiguration } from "../../../../src/domain/telemetry/OtlpConfiguration.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

function world() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("session.closed", "x", {}, SESSION, 2000)], AT);
  return { events, store };
}
const view = (c: { section: { value: string }; status: { value: string }; name: { value: string }; detail: { value: string } }) => [c.section.value, c.status.value, c.name.value, c.detail.value];

test("sin log: proyecciones OK y exportador desactivado", () => {
  const checks = new DiagnoseTelemetry(new InMemoryEventStore(), new InMemoryProjectionStore(), OtlpConfiguration.DISABLED, new ManualClock(0)).execute();
  assert.deepEqual(checks.map(view), [["telemetry", "OK", "telemetry projections", "no events yet"], ["telemetry", "OK", "otlp exporter", "disabled"]]);
});

test("proyecciones sin construir, atrasadas o con cuarentena: WARN con el remedio", () => {
  const { events, store } = world();
  const d = () => new DiagnoseTelemetry(events, store, OtlpConfiguration.DISABLED, new ManualClock(0)).execute()[0];
  assert.equal(d().status.value, "WARN");
  assert.match(d().detail.value, /telemetry_metrics not built yet; quality_kpis not built yet; start pi in this project or run underpass events rebuild <projection>/);
  new ProjectionRunner(events, store, [new TelemetryMetricsProjection(), new QualityKpisProjection()]).runOnce();
  assert.deepEqual([d().status.value, d().detail.value], ["OK", "up to date"]);
  events.append(SESSION, events.head(SESSION)!.version, [fact("session.opened", "o2")], AT);
  assert.match(d().detail.value, /telemetry_metrics at 2\/3; quality_kpis at 2\/3/);
  store.quarantine(QualityKpisProjection.NAME, GlobalPosition.of(1), "boom");
  assert.match(d().detail.value, /quality_kpis has 1 quarantined events/);
});

test("exportador: FAIL si la configuración es inválida, OK al día, WARN con más de 5 min de atraso; sólo nombres de cabeceras", () => {
  const { events, store } = world();
  const invalid = new DiagnoseTelemetry(events, store, OtlpConfiguration.fromEnvironment({ endpoint: "http://collector.internal:4318" }), new ManualClock(0)).execute()[1];
  assert.equal(invalid.status.value, "FAIL");
  assert.match(invalid.detail.value, /https:\/\/ outside localhost/);
  assert.equal(invalid.detail.value.includes("collector.internal"), false);
  const enabled = OtlpConfiguration.fromEnvironment({ endpoint: "http://localhost:4318", headers: "authorization=Bearer%20t0p" });
  const at = (ms: number) => new DiagnoseTelemetry(events, store, enabled, new ManualClock(ms)).execute()[1];
  assert.deepEqual(view(at(AT.epochMs() + 60_000)), ["telemetry", "OK", "otlp exporter", "lag 2 (localhost endpoint, headers: authorization)"]);
  const late = at(AT.epochMs() + 6 * 60_000);
  assert.equal(late.status.value, "WARN");
  assert.match(late.detail.value, /^2 events not exported for 6 min \(localhost endpoint, headers: authorization\)/);
  assert.match(late.detail.value, /if it stays stuck with the host running, run underpass events rebuild otlp_traces \(re-exports the whole log\)$/);
  assert.equal(late.detail.value.includes("t0p"), false);
  store.commit(TraceExport.NAME, ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.START), ProjectionCursor.of(TraceExport.VERSION, GlobalPosition.of(2)), new Map());
  assert.deepEqual(view(at(AT.epochMs() + 6 * 60_000)), ["telemetry", "OK", "otlp exporter", "up to date (localhost endpoint, headers: authorization)"]);
});
