import { test } from "node:test";
import assert from "node:assert/strict";
import { HistogramValue } from "../../../../src/domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../../../src/domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../../../src/domain/telemetry/MetricCatalog.ts";
import { MetricDescriptor } from "../../../../src/domain/telemetry/MetricDescriptor.ts";
import { MetricKey } from "../../../../src/domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../../../src/domain/telemetry/MetricLabels.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("un label fuera de [A-Za-z0-9_.:-] o de más de 64 caracteres pasa a other; lo ausente es unknown", () => {
  assert.equal(LabelValue.of("kmp_ask").value, "kmp_ask");
  assert.equal(LabelValue.of("claude-opus-5.5:latest").value, "claude-opus-5.5:latest");
  assert.equal(LabelValue.of("x".repeat(64)).value, "x".repeat(64));
  assert.equal(LabelValue.of("x".repeat(65)).value, "other");
  assert.equal(LabelValue.of("a b").value, "other");
  assert.equal(LabelValue.of("/home/u/secret").value, "other");
  assert.equal(LabelValue.of("").value, "other");
  assert.equal(LabelValue.orUnknown(undefined).value, "unknown");
  assert.equal(LabelValue.orUnknown(null).value, "unknown");
  assert.equal(LabelValue.orUnknown("").value, "unknown");
  assert.equal(LabelValue.orUnknown(137).value, "137");
  assert.equal(LabelValue.orUnknown({}).value, "other");
  assert.throws(() => LabelValue.of(3 as never), DomainError);
});

test("labels canónicos ordenados por nombre y clave de estado reversible", () => {
  const labels = MetricLabels.of({ tool: LabelValue.of("kmp_ask"), status: LabelValue.of("succeeded"), server: LabelValue.of("kmp") });
  assert.equal(labels.text, "server=kmp,status=succeeded,tool=kmp_ask");
  assert.deepEqual(labels.names(), ["server", "status", "tool"]);
  assert.equal(labels.get("tool"), "kmp_ask");
  assert.equal(labels.get("nope"), null);
  const key = MetricKey.of(MetricCatalog.TOOL_INVOCATIONS, labels);
  assert.equal(key.text, "counter|pi_runtime_tool_invocations_total|server=kmp,status=succeeded,tool=kmp_ask");
  const back = MetricKey.parse(key.text)!;
  assert.equal(back.descriptor, MetricCatalog.TOOL_INVOCATIONS);
  assert.ok(back.labels.equals(labels));
  assert.equal(MetricKey.parse("hist|pi_runtime_tool_duration_ms|server=kmp,tool=kmp_ask")?.descriptor, MetricCatalog.TOOL_DURATION);
  for (const bad of ["session|session:s1", "counter|pi_runtime_nope_total|", "hist|pi_runtime_tool_invocations_total|server=kmp,status=ok,tool=t",
    "counter|pi_runtime_tool_invocations_total|tool=t", "a|b|c|d"]) assert.equal(MetricKey.parse(bad), null, bad);
  assert.throws(() => MetricKey.of(MetricCatalog.SESSIONS, MetricLabels.of({ reason: LabelValue.of("x") })), DomainError);
  assert.throws(() => MetricLabels.parse("novalue"), DomainError);
  assert.throws(() => MetricLabels.of({ "Bad-Name": LabelValue.of("x") }), DomainError);
  assert.equal(MetricLabels.parse("").text, "");
  assert.ok(MetricLabels.NONE.equals(MetricLabels.parse("")));
});

test("el catálogo es el de la spec", () => {
  assert.deepEqual(MetricCatalog.ALL.map((d) => `${d.kind} ${d.name} ${d.labelNames.join(",")}`), [
    "counter pi_runtime_tool_invocations_total server,status,tool",
    "counter pi_runtime_tool_refused_total reason,tool",
    "histogram pi_runtime_tool_duration_ms server,tool",
    "counter pi_runtime_turns_total model,outcome,provider",
    "counter pi_runtime_tokens_total kind,model,provider",
    "counter pi_runtime_cost_total model,provider",
    "counter pi_runtime_sessions_total event",
    "counter pi_runtime_compactions_total reason",
    "counter pi_runtime_server_starts_total server",
    "counter pi_runtime_server_exits_total code,server",
  ]);
  assert.equal(MetricCatalog.COST.integer, false);
  assert.equal(MetricCatalog.TURNS.integer, true);
  assert.equal(MetricCatalog.find("pi_runtime_nope_total"), null);
  assert.throws(() => MetricDescriptor.counter("pi_runtime_x", "h", []), DomainError);
  assert.throws(() => MetricDescriptor.counter("other_total", "h", []), DomainError);
  assert.throws(() => MetricDescriptor.histogram("pi_runtime_h", "h", ["le"]), DomainError);
});

test("histograma: cubos de la spec, acumulados, desbordamiento y cuantiles estimados", () => {
  let h = HistogramValue.EMPTY;
  for (const ms of [5, 10, 11, 700, 90_000]) h = h.observe(ms);
  assert.deepEqual(HistogramValue.BOUNDS, [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]);
  assert.deepEqual(h.toJson(), { buckets: [2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], sum: 90_726, count: 5 });
  assert.deepEqual(h.bucketCounts(), [2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(h.cumulative(), [2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5]);
  assert.equal(h.quantile(0.5), 50);
  assert.equal(h.quantile(0.95), Number.POSITIVE_INFINITY);
  assert.equal(HistogramValue.EMPTY.quantile(0.5), null);
  assert.deepEqual(HistogramValue.fromJson(h.toJson()).toJson(), h.toJson());
  for (const bad of [null, {}, { buckets: [1], sum: 0, count: 1 }, { buckets: new Array(11).fill(1), sum: 1, count: 2 }, { buckets: new Array(11).fill(0), sum: Number.NaN, count: 0 }]) {
    assert.throws(() => HistogramValue.fromJson(bad), DomainError);
  }
  assert.throws(() => h.observe(-1), DomainError);
});
