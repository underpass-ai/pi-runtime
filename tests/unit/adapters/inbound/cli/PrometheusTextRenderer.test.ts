import { test } from "node:test";
import assert from "node:assert/strict";
import { PrometheusTextRenderer } from "../../../../../src/adapters/inbound/cli/PrometheusTextRenderer.ts";
import { HistogramValue } from "../../../../../src/domain/telemetry/HistogramValue.ts";
import { LabelValue } from "../../../../../src/domain/telemetry/LabelValue.ts";
import { MetricCatalog } from "../../../../../src/domain/telemetry/MetricCatalog.ts";
import { MetricKey } from "../../../../../src/domain/telemetry/MetricKey.ts";
import { MetricLabels } from "../../../../../src/domain/telemetry/MetricLabels.ts";
import { MetricPoint } from "../../../../../src/domain/telemetry/MetricPoint.ts";
import { MetricsSnapshot } from "../../../../../src/domain/telemetry/MetricsSnapshot.ts";

test("formato de exposición: HELP, TYPE, labels ordenados e histograma con _bucket{le}, _sum y _count", () => {
  const tool = { server: LabelValue.of("kmp"), tool: LabelValue.of("kmp_ask") };
  const snapshot = MetricsSnapshot.of([
    MetricPoint.counter(MetricKey.of(MetricCatalog.COST, MetricLabels.of({ provider: LabelValue.of("p1"), model: LabelValue.of("m1") })), 0.75),
    MetricPoint.histogram(MetricKey.of(MetricCatalog.TOOL_DURATION, MetricLabels.of(tool)), HistogramValue.EMPTY.observe(40).observe(700)),
    MetricPoint.counter(MetricKey.of(MetricCatalog.TOOL_INVOCATIONS, MetricLabels.of({ ...tool, status: LabelValue.of("succeeded") })), 3),
  ]);
  assert.equal(new PrometheusTextRenderer().render(snapshot), [
    "# HELP pi_runtime_tool_invocations_total Tool invocations by final status.",
    "# TYPE pi_runtime_tool_invocations_total counter",
    'pi_runtime_tool_invocations_total{server="kmp",status="succeeded",tool="kmp_ask"} 3',
    "# HELP pi_runtime_tool_duration_ms Tool invocation duration in milliseconds.",
    "# TYPE pi_runtime_tool_duration_ms histogram",
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="10"} 0',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="50"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="100"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="250"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="500"} 1',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="1000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="2500"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="5000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="10000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="30000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="60000"} 2',
    'pi_runtime_tool_duration_ms_bucket{server="kmp",tool="kmp_ask",le="+Inf"} 2',
    'pi_runtime_tool_duration_ms_sum{server="kmp",tool="kmp_ask"} 740',
    'pi_runtime_tool_duration_ms_count{server="kmp",tool="kmp_ask"} 2',
    "# HELP pi_runtime_cost_total Model cost in the unit reported by Pi.",
    "# TYPE pi_runtime_cost_total counter",
    'pi_runtime_cost_total{model="m1",provider="p1"} 0.75',
  ].join("\n"));
  assert.equal(new PrometheusTextRenderer().render(MetricsSnapshot.of([])), "");
});
