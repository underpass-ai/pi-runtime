import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MetricCatalog } from "../../../src/domain/telemetry/MetricCatalog.ts";

const file = (name: string) => readFileSync(fileURLToPath(new URL(`../../../deploy/observability/${name}`, import.meta.url)), "utf8");
const KNOWN = new Set(MetricCatalog.ALL.flatMap((d) => (d.kind === "histogram" ? [`${d.name}_bucket`, `${d.name}_sum`, `${d.name}_count`] : [d.name])));
const referenced = (text: string) => [...new Set(text.match(/pi_runtime_[a-z_]+/g) ?? [])];

test("el dashboard de Grafana es JSON válido, sólo usa métricas del catálogo y las cubre todas", () => {
  const dash = JSON.parse(file("pi-runtime.dashboard.json")) as { uid: string; title: string; panels: { id: number; title: string; type: string; targets: { refId: string; expr: string }[] }[] };
  assert.deepEqual([dash.uid, dash.title], ["pi-runtime", "Pi Runtime"]);
  assert.ok(dash.panels.length >= 8);
  assert.equal(new Set(dash.panels.map((p) => p.id)).size, dash.panels.length);
  for (const p of dash.panels) {
    assert.ok(p.title && p.type && p.targets.length > 0, p.title);
    for (const t of p.targets) assert.ok(t.refId && t.expr, p.title);
  }
  // Fuente de datos elegible: variable DS_PROMETHEUS (tipo datasource) usada por cada panel y cada consulta.
  const raw = JSON.parse(file("pi-runtime.dashboard.json")) as { templating: { list: { name: string; type: string; query: string }[] }; panels: { title: string; datasource: { type: string; uid: string }; targets: { datasource?: { type: string; uid: string } }[] }[] };
  assert.deepEqual(raw.templating.list.filter((v) => v.name === "DS_PROMETHEUS").map((v) => [v.type, v.query]), [["datasource", "prometheus"]]);
  for (const p of raw.panels) {
    assert.deepEqual(p.datasource, { type: "prometheus", uid: "${DS_PROMETHEUS}" }, p.title);
    for (const t of p.targets) assert.deepEqual(t.datasource, { type: "prometheus", uid: "${DS_PROMETHEUS}" }, p.title);
  }
  const exprs = dash.panels.flatMap((p) => p.targets.map((t) => t.expr)).join("\n");
  assert.deepEqual(referenced(exprs).filter((m) => !KNOWN.has(m)), []);
  const covered = referenced(exprs).map((m) => m.replace(/_(bucket|sum|count)$/, ""));
  assert.deepEqual(MetricCatalog.ALL.map((d) => d.name).filter((n) => !covered.includes(n)), [], "el dashboard usa todas las métricas");
});

test("las reglas son un PrometheusRule bien formado con las cuatro alertas de la spec", () => {
  const text = file("pi-runtime.rules.yaml");
  assert.equal(/\t/.test(text), false, "YAML sin tabuladores");
  assert.match(text, /^apiVersion: monitoring\.coreos\.com\/v1\nkind: PrometheusRule\n/);
  for (const line of text.split("\n")) if (line.trim() !== "") assert.equal((line.length - line.trimStart().length) % 2, 0, `indentación par: ${line}`);
  const alerts = text.split(/\n\s*- alert: /).slice(1).map((block) => ({ name: block.split("\n")[0].trim(), block }));
  assert.deepEqual(alerts.map((a) => a.name), ["PiRuntimeToolFailureRateHigh", "PiRuntimeToolRefusalsHigh", "PiRuntimeToolLatencyP95High", "PiRuntimeTelemetryAbsent"]);
  assert.deepEqual(alerts.map((a) => /\n\s+for: (\S+)/.exec(a.block)?.[1]), ["10m", "10m", "10m", "30m"]);
  for (const a of alerts) {
    assert.match(a.block, /\n\s+expr: /, a.name);
    assert.match(a.block, /\n\s+severity: (warning|info)\n/, a.name);
    assert.match(a.block, /\n\s+summary: \S/, a.name);
  }
  assert.match(alerts[0].block, /status="failed"[\s\S]*> 0\.05/);
  assert.match(alerts[1].block, /pi_runtime_tool_refused_total\[10m\]\)\) > 0\.5/);
  assert.match(alerts[2].block, /histogram_quantile\(0\.95,[\s\S]*> 2000/);
  assert.match(alerts[3].block, /absent\(pi_runtime_sessions_total\)/);
  assert.deepEqual(referenced(text).filter((m) => !KNOWN.has(m)), []);
});
