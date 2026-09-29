import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { OtlpJsonMapper } from "../../../../../src/adapters/outbound/otlp/OtlpJsonMapper.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../../src/domain/events/Timestamp.ts";
import { TelemetryInstanceId } from "../../../../../src/domain/telemetry/TelemetryInstanceId.ts";
import { HistogramValue } from "../../../../../src/domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../../../../src/domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../../../../src/domain/telemetry/MetricCatalog.ts";
import type { MetricDescriptor } from "../../../../../src/domain/telemetry/MetricDescriptor.ts";
import { MetricKey } from "../../../../../src/domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../../../../src/domain/telemetry/MetricLabels.ts";
import { MetricPoint } from "../../../../../src/domain/telemetry/MetricPoint.ts";
import { MetricsSnapshot } from "../../../../../src/domain/telemetry/MetricsSnapshot.ts";
import { SpanAssembler } from "../../../../../src/domain/telemetry/SpanAssembler.ts";
import { TelemetryResource } from "../../../../../src/domain/telemetry/TelemetryResource.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

const RESOURCE = TelemetryResource.of("0.1.0", TelemetryInstanceId.of("0123456789abcdef"));
type J = any;

test("trazas: ExportTraceServiceRequest con ids hex, tiempos en ns como texto, atributos tipados y status", () => {
  const store = new InMemoryEventStore();
  store.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", {}, SESSION, 1000),
    fact("phase.changed", "p", { to: "design" }, SESSION, 1100),
    fact("tool.started", "c1s", { tool: "bash", server: "pi", callId: "c1", argsBytes: 12 }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "bash", server: "pi", callId: "c1", status: "failed", outputBytes: 3 }, SESSION, 2400),
    fact("turn.completed", "t", { cost: 0.5, outcome: "completed", durationMs: 1000 }, SESSION, 3000),
  ], AT);
  const a = new SpanAssembler(SpanAssembler.empty());
  const spans = [...store.readStream(SESSION).flatMap((r) => a.feed(r)), ...a.flush(Timestamp.fromEpochMs(4000))];
  const body = new OtlpJsonMapper("0.1.0").traces(RESOURCE, spans) as J;
  assert.deepEqual(Object.keys(body), ["resourceSpans"]);
  const rs = body.resourceSpans[0];
  assert.deepEqual(rs.resource.attributes, [
    { key: "pi_runtime.project", value: { stringValue: "0123456789abcdef" } },
    { key: "service.instance.id", value: { stringValue: "0123456789abcdef" } },
    { key: "service.name", value: { stringValue: "pi-runtime" } },
    { key: "service.version", value: { stringValue: "0.1.0" } },
  ]);
  assert.deepEqual(rs.scopeSpans[0].scope, { name: "pi-runtime", version: "0.1.0" });
  const out = rs.scopeSpans[0].spans;
  assert.deepEqual(out.map((s: J) => s.name), ["turn", "tool", "session"]);
  const [turn, tool, session] = out;
  assert.deepEqual(Object.keys(tool).sort(), ["attributes", "endTimeUnixNano", "events", "kind", "name", "parentSpanId", "spanId", "startTimeUnixNano", "status", "traceId"]);
  assert.match(tool.traceId, /^[0-9a-f]{32}$/);
  assert.match(tool.spanId, /^[0-9a-f]{16}$/);
  assert.equal(tool.parentSpanId, turn.spanId);
  assert.equal(turn.parentSpanId, session.spanId);
  assert.equal("parentSpanId" in session, false);
  assert.deepEqual([tool.kind, tool.startTimeUnixNano, tool.endTimeUnixNano, tool.status], [1, "2000000000", "2400000000", { code: 2 }]);
  assert.deepEqual(tool.attributes, [
    { key: "pi_runtime.args_bytes", value: { intValue: "12" } },
    { key: "pi_runtime.output_bytes", value: { intValue: "3" } },
    { key: "pi_runtime.server", value: { stringValue: "pi" } },
    { key: "pi_runtime.status", value: { stringValue: "failed" } },
    { key: "pi_runtime.tool", value: { stringValue: "bash" } },
  ]);
  assert.deepEqual(turn.attributes.find((x: J) => x.key === "pi_runtime.cost"), { key: "pi_runtime.cost", value: { doubleValue: 0.5 } });
  assert.deepEqual(session.status, { code: 0 });
  assert.deepEqual(session.events, [{ timeUnixNano: "1100000000", name: "phase.changed", attributes: [{ key: "pi_runtime.phase.to", value: { stringValue: "design" } }] }]);
  assert.deepEqual(session.attributes.find((x: J) => x.key === "pi_runtime.incomplete"), { key: "pi_runtime.incomplete", value: { boolValue: true } });
});

test("métricas: sum CUMULATIVE monótona (asInt o asDouble) e histograma con 12 cubos y 11 límites", () => {
  const key = (d: MetricDescriptor, labels: Record<string, LabelValue>) => MetricKey.of(d, MetricLabels.of(labels));
  const snapshot = MetricsSnapshot.of([
    MetricPoint.counter(key(MetricCatalog.SESSIONS, { event: LabelValue.of("opened") }), 2),
    MetricPoint.counter(key(MetricCatalog.COST, { model: LabelValue.of("m"), provider: LabelValue.of("p") }), 0.75),
    MetricPoint.histogram(key(MetricCatalog.TOOL_DURATION, { server: LabelValue.of("kmp"), tool: LabelValue.of("kmp_ask") }), HistogramValue.EMPTY.observe(40).observe(90_000)),
  ]);
  const body = new OtlpJsonMapper("0.1.0").metrics(RESOURCE, snapshot, Timestamp.fromEpochMs(1000), Timestamp.fromEpochMs(16_000)) as J;
  assert.deepEqual(body.resourceMetrics[0].scopeMetrics[0].scope, { name: "pi-runtime", version: "0.1.0" });
  const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.deepEqual(metrics.map((m: J) => m.name), ["pi_runtime_tool_duration_ms", "pi_runtime_cost_total", "pi_runtime_sessions_total"]);
  const [duration, cost, sessions] = metrics;
  assert.deepEqual(sessions, { name: "pi_runtime_sessions_total", description: "Session lifecycle events.", unit: "", sum: { aggregationTemporality: 2, isMonotonic: true,
    dataPoints: [{ attributes: [{ key: "event", value: { stringValue: "opened" } }], startTimeUnixNano: "1000000000", timeUnixNano: "16000000000", asInt: "2" }] } });
  assert.equal(cost.sum.dataPoints[0].asDouble, 0.75);
  assert.equal("asInt" in cost.sum.dataPoints[0], false);
  assert.equal(duration.histogram.aggregationTemporality, 2);
  assert.deepEqual(duration.histogram.dataPoints[0], {
    attributes: [{ key: "server", value: { stringValue: "kmp" } }, { key: "tool", value: { stringValue: "kmp_ask" } }],
    startTimeUnixNano: "1000000000", timeUnixNano: "16000000000", count: "2", sum: 90_040,
    bucketCounts: ["0", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1"], explicitBounds: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  });
});

test("atributos numéricos: el tipo depende de la clave, no del valor (cost siempre double; bytes, tokens y códigos siempre int)", () => {
  const store = new InMemoryEventStore();
  store.append(SESSION, StreamVersion.NONE, [
    fact("session.opened", "o", {}, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "bash", server: "pi", callId: "c1", argsBytes: 12.6 }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "bash", server: "pi", callId: "c1", status: "succeeded", outputBytes: 3 }, SESSION, 2400),
    fact("turn.completed", "t", { cost: 1, tokens: { input: 7 } }, SESSION, 3000),
  ], AT);
  const a = new SpanAssembler(SpanAssembler.empty());
  const spans = store.readStream(SESSION).flatMap((r) => a.feed(r));
  const out = (new OtlpJsonMapper("0.1.0").traces(RESOURCE, spans) as J).resourceSpans[0].scopeSpans[0].spans;
  const attr = (name: string, key: string) => out.find((s: J) => s.name === name).attributes.find((x: J) => x.key === key)?.value;
  assert.deepEqual(attr("turn", "pi_runtime.cost"), { doubleValue: 1 });
  assert.deepEqual(attr("turn", "pi_runtime.tokens.input"), { intValue: "7" });
  assert.deepEqual(attr("tool", "pi_runtime.args_bytes"), { intValue: "13" });
  assert.deepEqual(attr("tool", "pi_runtime.output_bytes"), { intValue: "3" });
});

test("atributos numéricos no finitos se descartan", () => {
  const fake = { traceId: { value: "0".repeat(32) }, spanId: { value: "0".repeat(16) }, parentId: null, name: "turn", start: { epochMs: () => 1 }, end: { epochMs: () => 2 },
    status: { isError: () => false }, events: [], attributes: { entries: () => [["pi_runtime.cost", Number.NaN], ["pi_runtime.tokens.input", Number.POSITIVE_INFINITY], ["pi_runtime.model", "m"]] } };
  const span = (new OtlpJsonMapper("0.1.0").traces(RESOURCE, [fake as never]) as J).resourceSpans[0].scopeSpans[0].spans[0];
  assert.deepEqual(span.attributes, [{ key: "pi_runtime.model", value: { stringValue: "m" } }]);
});
