import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventStore } from "../../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import { OtlpHttpTelemetrySink } from "../../../../../src/adapters/outbound/otlp/OtlpHttpTelemetrySink.ts";
import { OtlpJsonMapper } from "../../../../../src/adapters/outbound/otlp/OtlpJsonMapper.ts";
import { SqliteDatabase } from "../../../../../src/adapters/outbound/sqlite/SqliteDatabase.ts";
import { SqliteEventStore } from "../../../../../src/adapters/outbound/sqlite/SqliteEventStore.ts";
import { SqliteProjectionStore } from "../../../../../src/adapters/outbound/sqlite/SqliteProjectionStore.ts";
import type { EventStore } from "../../../../../src/application/ports/EventStore.ts";
import { TelemetryMetricsProjection } from "../../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ProjectionRunner } from "../../../../../src/application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../../../../../src/application/services/TelemetryEpochs.ts";
import { MetricsExport } from "../../../../../src/application/use-cases/MetricsExport.ts";
import { ReadTelemetryMetrics } from "../../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { RebuildProjection } from "../../../../../src/application/use-cases/RebuildProjection.ts";
import { TraceExport } from "../../../../../src/application/use-cases/TraceExport.ts";
import { StreamVersion } from "../../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../../src/domain/events/Timestamp.ts";
import { ProjectId } from "../../../../../src/domain/project/ProjectId.ts";
import { ExportResult } from "../../../../../src/domain/telemetry/ExportResult.ts";
import { MetricsSnapshot } from "../../../../../src/domain/telemetry/MetricsSnapshot.ts";
import { OtlpConfiguration } from "../../../../../src/domain/telemetry/OtlpConfiguration.ts";
import { TelemetryResource } from "../../../../../src/domain/telemetry/TelemetryResource.ts";
import { ManualClock } from "../../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../../support/recordFixtures.ts";

type J = any;
type Hit = { path: string; status: number; headers: IncomingHttpHeaders; body: J };

const RESOURCE = TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"));
const NOW = Timestamp.fromEpochMs(10_000);

async function collector(respond: (path: string, n: number) => number | "hang" = () => 200) {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      const status = respond(req.url ?? "", hits.length);
      if (status === "hang") return;
      hits.push({ path: req.url ?? "", status, headers: req.headers, body: JSON.parse(data) });
      res.writeHead(status, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { hits, url, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const accepted = (hits: Hit[]): J[] => hits.filter((h) => h.status < 300 && h.path === "/v1/traces").flatMap((h) => h.body.resourceSpans[0].scopeSpans[0].spans);
const sinkFor = (url: string, extra: { headers?: string; timeout?: string } = {}) =>
  new OtlpHttpTelemetrySink(OtlpConfiguration.fromEnvironment({ endpoint: url, ...extra }).settings!, new OtlpJsonMapper("0.1.0"));
const world = () => ({ events: new InMemoryEventStore(), store: new InMemoryProjectionStore() });

// Un campo que no es de E1 (`prompt`) con texto y una ruta: el ensamblador nunca lo copia.
function session(events: EventStore, calls = 2): void {
  const facts = [fact("session.opened", "o", { reason: "startup" }, SESSION, 1000)];
  for (let i = 0; i < calls; i++) facts.push(
    fact("tool.started", `c${i}s`, { tool: "kmp_ask", server: "kmp", callId: `c${i}`, prompt: "SECRET-PROMPT /home/u/private" }, SESSION, 2000),
    fact("tool.completed", `c${i}`, { tool: "kmp_ask", server: "kmp", callId: `c${i}`, durationMs: 5, status: "succeeded" }, SESSION, 2005),
    fact("turn.completed", `t${i}`, { durationMs: 10, model: "m", provider: "p" }, SESSION, 2010));
  facts.push(fact("session.closed", "x", {}, SESSION, 3000));
  events.append(SESSION, StreamVersion.NONE, facts, AT);
}

test("trazas y métricas llegan en OTLP/JSON con las cabeceras de OTEL_EXPORTER_OTLP_HEADERS y sin contenido sensible", async () => {
  const c = await collector();
  try {
    const { events, store } = world();
    session(events);
    new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
    const sink = sinkFor(c.url, { headers: "authorization=Bearer%20s3cr3t,x-tenant=acme" });
    const clock = new ManualClock(20_000);
    assert.equal((await new TraceExport(events, store, sink, RESOURCE).execute(NOW)).kind, "ok");
    assert.equal((await new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock).execute()).kind, "ok");
    assert.deepEqual(c.hits.map((h) => h.path), ["/v1/traces", "/v1/metrics"]);
    for (const h of c.hits) {
      assert.equal(h.headers["content-type"], "application/json");
      assert.equal(h.headers.authorization, "Bearer s3cr3t");
      assert.equal(h.headers["x-tenant"], "acme");
    }
    const spans = accepted(c.hits);
    assert.equal(spans.length, 2 * 2 + 1);
    const ids = new Set(spans.map((s) => s.spanId));
    assert.ok(spans.every((s) => s.parentSpanId === undefined || ids.has(s.parentSpanId)), "trazas completas: todo padre existe");
    assert.ok(c.hits[1].body.resourceMetrics[0].scopeMetrics[0].metrics.some((m: J) => m.name === "pi_runtime_tool_invocations_total"));
    const wire = JSON.stringify(c.hits.map((h) => h.body));
    for (const secret of ["SECRET-PROMPT", "/home/u/private", homedir(), "s3cr3t", ...(hostname().length > 3 ? [hostname()] : [])]) assert.equal(wire.includes(secret), false, secret);
  } finally { await c.close(); }
});

test("caída del colector (503) y reintento: el cursor no avanza hasta el 2xx y no hay duplicados aceptados", async () => {
  const c = await collector((_, n) => (n === 0 ? 503 : 200));
  try {
    const { events, store } = world();
    session(events);
    const exporter = new TraceExport(events, store, sinkFor(c.url), RESOURCE);
    assert.deepEqual(await exporter.execute(NOW), ExportResult.retryable("http 503"));
    assert.equal(exporter.lag(), events.lastPosition().value);
    assert.equal((await exporter.execute(NOW)).kind, "ok");
    const spans = accepted(c.hits);
    assert.equal(spans.length, 5);
    assert.equal(new Set(spans.map((s) => s.spanId)).size, 5);
    assert.equal(c.hits[0].body.resourceSpans[0].scopeSpans[0].spans.length, 5, "el intento fallido llevaba el mismo lote");
  } finally { await c.close(); }
});

test("un 4xx se descarta: el cursor avanza y no se reenvía", async () => {
  const c = await collector(() => 400);
  try {
    const { events, store } = world();
    session(events);
    const exporter = new TraceExport(events, store, sinkFor(c.url), RESOURCE);
    const r = await exporter.execute(NOW);
    assert.deepEqual([r.kind, r.reason], ["rejected", "http 400"]);
    assert.equal(exporter.lag(), 0);
    await exporter.execute(NOW);
    assert.equal(c.hits.length, 1);
  } finally { await c.close(); }
});

test("sin colector o sin respuesta: reintentable con un motivo que no nombra el endpoint", async () => {
  const down = await collector(); const url = down.url; await down.close();
  const r = await sinkFor(url).sendSpans(RESOURCE, []);
  assert.equal(r.kind, "retryable");
  assert.match(r.reason, /^network( [A-Z0-9_]+| error)$/);
  assert.equal(r.reason.includes("127.0.0.1"), false);
  const hang = await collector(() => "hang");
  try {
    const t = await sinkFor(hang.url, { timeout: "200" }).sendSpans(RESOURCE, []);
    assert.deepEqual([t.kind, t.reason], ["retryable", "timeout"]);
  } finally { await hang.close(); }
});

test("reexportar (rebuild otlp_traces) manda los mismos ids: el colector no ve spans nuevos", async () => {
  const c = await collector();
  try {
    const { events, store } = world();
    session(events, 3);
    const exporter = new TraceExport(events, store, sinkFor(c.url), RESOURCE);
    await exporter.execute(NOW);
    const first = accepted(c.hits).map((s) => s.spanId).sort();
    new RebuildProjection(new ProjectionRunner(events, store, []), store).execute(TraceExport.NAME);
    while (exporter.lag() > 0) await exporter.execute(NOW);
    const all = accepted(c.hits).map((s) => s.spanId);
    assert.equal(all.length, first.length * 2);
    assert.deepEqual([...new Set(all)].sort(), first);
  } finally { await c.close(); }
});

test("reinicio del host a mitad de lote (SQLite): estado y cursor sobreviven, sin perder ni duplicar spans", async () => {
  const c = await collector();
  const file = join(mkdtempSync(join(tmpdir(), "otlp-")), "events.sqlite3");
  try {
    let db = SqliteDatabase.open(file);
    let events = new SqliteEventStore(db);
    const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
    for (let i = 0; i < 300; i++) facts.push(fact("tool.completed", `c${i}`, { tool: "t", server: "pi", callId: `c${i}`, status: "succeeded" }, SESSION, 2000), fact("turn.completed", `t${i}`, {}, SESSION, 2001));
    facts.push(fact("tool.started", "open1", { tool: "kmp_ask", server: "kmp", callId: "open1" }, SESSION, 5000));
    events.append(SESSION, StreamVersion.NONE, facts, AT);
    await new TraceExport(events, new SqliteProjectionStore(db), sinkFor(c.url), RESOURCE).execute(NOW);
    assert.equal(accepted(c.hits).length, 512);
    db.close(); // el host muere tras el primer lote

    db = SqliteDatabase.open(file); events = new SqliteEventStore(db);
    const exporter = new TraceExport(events, new SqliteProjectionStore(db), sinkFor(c.url), RESOURCE);
    while (exporter.lag() > 0) await exporter.execute(NOW);
    events.append(SESSION, events.head(SESSION)!.version, [fact("tool.completed", "open1c", { tool: "kmp_ask", server: "kmp", callId: "open1", status: "succeeded" }, SESSION, 6000), fact("session.closed", "x", {}, SESSION, 7000)], AT);
    db.close(); // y otra vez con el tool.started pendiente en el estado

    db = SqliteDatabase.open(file); events = new SqliteEventStore(db);
    const again = new TraceExport(events, new SqliteProjectionStore(db), sinkFor(c.url), RESOURCE);
    while (again.lag() > 0) await again.execute(NOW);
    const spans = accepted(c.hits);
    assert.equal(spans.length, 600 + 2);
    assert.equal(new Set(spans.map((s) => s.spanId)).size, spans.length);
    const open = spans.find((s) => s.name === "tool" && s.attributes.some((a: J) => a.key === "pi_runtime.tool" && a.value.stringValue === "kmp_ask"));
    assert.equal(open.startTimeUnixNano, "5000000000", "el tool.started de antes del reinicio sigue en el estado");
    db.close();
  } finally { await c.close(); }
});

test("fetch que falla: el motivo es sólo un código, nunca el mensaje (que puede llevar endpoint o cabeceras); 429 reintenta", async () => {
  const settings = OtlpConfiguration.fromEnvironment({ endpoint: "https://otel.example.com", headers: "authorization=s3cr3t" }).settings!;
  const failing = (e: unknown) => new OtlpHttpTelemetrySink(settings, new OtlpJsonMapper("0.1.0"), () => Promise.reject(e));
  const leak = "fetch failed https://otel.example.com authorization=s3cr3t";
  const cases: [unknown, string][] = [
    [Object.assign(new Error(leak), { cause: { code: "ECONNRESET", message: leak } }), "network ECONNRESET"],
    [Object.assign(new Error(leak), { cause: { code: `bad code ${leak}` } }), "network error"],
    [new TypeError(leak), "network error"],
    [null, "network error"],
    [Object.assign(new Error(leak), { name: "AbortError" }), "timeout"],
  ];
  for (const [e, reason] of cases) {
    const r = await failing(e).sendSpans(RESOURCE, []);
    assert.deepEqual([r.kind, r.reason], ["retryable", reason]);
  }
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const answering = (status: number) => new OtlpHttpTelemetrySink(settings, new OtlpJsonMapper("0.1.0"), async (url, init) => {
    seen.push({ url, headers: init.headers });
    return { status, arrayBuffer: () => Promise.reject(new Error(leak)) };
  });
  assert.deepEqual(await answering(429).sendSpans(RESOURCE, []), ExportResult.retryable("http 429"));
  assert.deepEqual(await answering(204).sendMetrics(RESOURCE, MetricsSnapshot.of([]), NOW, NOW), ExportResult.ok());
  assert.deepEqual(seen.map((s) => s.url), ["https://otel.example.com/v1/traces", "https://otel.example.com/v1/metrics"]);
  assert.deepEqual(seen[0].headers, { authorization: "s3cr3t", "content-type": "application/json" });
});
