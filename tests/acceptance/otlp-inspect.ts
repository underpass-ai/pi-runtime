#!/usr/bin/env node
// Revisa lo que guardó otlp-receiver.ts: en cada traza con raíz (session u host cerrados),
// todo parentSpanId existe; cuenta spans únicos y métricas; y falla si aparece HOME, el
// hostname, el usuario o cualquiera de las cadenas prohibidas que se le pasen.
import { readdirSync, readFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";

type OtlpSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string };
const [dir, ...forbidden] = process.argv.slice(2);
if (!dir) { console.error("usage: node tests/acceptance/otlp-inspect.ts <dir> [forbidden-string…]"); process.exit(2); }
const secrets = [homedir(), hostname(), userInfo().username, ...forbidden].filter((s) => s.length >= 4);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const spans: OtlpSpan[] = []; const metrics = new Set<string>(); const problems: string[] = [];
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  if (secrets.some((s) => text.includes(s))) problems.push(`${f} contains a forbidden string`);
  const body = JSON.parse(text) as { resourceSpans?: { scopeSpans: { spans: OtlpSpan[] }[] }[]; resourceMetrics?: { scopeMetrics: { metrics: { name: string }[] }[] }[] };
  for (const rs of body.resourceSpans ?? []) for (const ss of rs.scopeSpans) spans.push(...ss.spans);
  for (const rm of body.resourceMetrics ?? []) for (const sm of rm.scopeMetrics) for (const m of sm.metrics) metrics.add(m.name);
}
const ids = new Set(spans.map((s) => `${s.traceId}/${s.spanId}`));
const rooted = new Set(spans.filter((s) => s.parentSpanId === undefined).map((s) => s.traceId));
let openTraceSpans = 0;
for (const s of spans) {
  if (s.parentSpanId === undefined || ids.has(`${s.traceId}/${s.parentSpanId}`)) continue;
  if (rooted.has(s.traceId)) problems.push(`span ${s.name} ${s.spanId}: parent ${s.parentSpanId} missing in a closed trace`);
  else openTraceSpans++;
}
const byName: Record<string, number> = {};
for (const s of spans) byName[s.name] = (byName[s.name] ?? 0) + 1;
console.log(JSON.stringify({ files: files.length, spans: spans.length, uniqueSpans: ids.size, traces: new Set(spans.map((s) => s.traceId)).size,
  spansInOpenTraces: openTraceSpans, byName, metrics: [...metrics].sort() }, null, 2));
for (const p of problems) console.error(p);
process.exit(problems.length === 0 ? 0 : 1);
