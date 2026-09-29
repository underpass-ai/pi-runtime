import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import { InMemoryTelemetryEpochStore } from "../../../../src/adapters/outbound/memory/InMemoryTelemetryEpochStore.ts";
import type { HostLog } from "../../../../src/application/ports/HostLog.ts";
import { TelemetryMetricsProjection } from "../../../../src/application/projections/TelemetryMetricsProjection.ts";
import { ExporterHealth } from "../../../../src/application/services/ExporterHealth.ts";
import { ProjectionRunner } from "../../../../src/application/services/ProjectionRunner.ts";
import { TelemetryEpochs } from "../../../../src/application/services/TelemetryEpochs.ts";
import { TelemetryExporter } from "../../../../src/application/services/TelemetryExporter.ts";
import { MetricsExport } from "../../../../src/application/use-cases/MetricsExport.ts";
import { ReadTelemetryMetrics } from "../../../../src/application/use-cases/ReadTelemetryMetrics.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { ProjectId } from "../../../../src/domain/project/ProjectId.ts";
import { ExportResult } from "../../../../src/domain/telemetry/ExportResult.ts";
import { TelemetryResource } from "../../../../src/domain/telemetry/TelemetryResource.ts";
import { FakeTelemetrySink } from "../../../support/FakeTelemetrySink.ts";
import { ManualClock } from "../../../support/ManualClock.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const RESOURCE = TelemetryResource.of("0.1.0", ProjectId.of("0123456789abcdef"));
const t = (ms: number) => Timestamp.fromEpochMs(ms);

function world() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const sink = new FakeTelemetrySink(); const clock = new ManualClock(0);
  const lines: string[] = [];
  const log: HostLog = { info: (m) => { lines.push(m); }, warn: (m) => { lines.push(m); }, error: (m) => { lines.push(m); } };
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("session.closed", "x", {}, SESSION, 2000)], AT);
  new ProjectionRunner(events, store, [new TelemetryMetricsProjection()]).runOnce();
  const metrics = new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock);
  const exporter = new TelemetryExporter(new TraceExport(events, store, sink, RESOURCE), metrics, new ExporterHealth(log), clock);
  return { events, store, sink, clock, lines, metrics, exporter };
}

test("métricas: snapshot acumulado desde el inicio del acumulado; sin series no se envía nada", async () => {
  const { sink, clock, metrics } = world();
  const empty = new MetricsExport(new ReadTelemetryMetrics(new InMemoryEventStore(), new InMemoryProjectionStore()), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock);
  assert.equal((await empty.execute()).kind, "ok");
  assert.equal(sink.metrics.length, 0);
  clock.ms = 20_000; await metrics.execute();
  clock.ms = 35_000; await metrics.execute();
  assert.deepEqual(sink.metrics.map((m) => [m.start.epochMs(), m.at.epochMs()]), [[20_000, 20_000], [20_000, 35_000]]);
  assert.deepEqual(sink.metrics[1].snapshot.points().map((p) => p.key.text), ["counter|pi_runtime_sessions_total|event=closed", "counter|pi_runtime_sessions_total|event=opened"]);
});

test("salud del exportador: una línea por cambio de estado y el estado para /underpass-status", () => {
  const lines: string[] = [];
  const log: HostLog = { info: (m, f) => { lines.push(`info ${m} ${JSON.stringify(f ?? {})}`); }, warn: (m, f) => { lines.push(`warn ${m} ${JSON.stringify(f ?? {})}`); }, error: (m) => { lines.push(`error ${m}`); } };
  const h = new ExporterHealth(log);
  assert.deepEqual(h.status(3), { state: "ok", lag: 3, since: null });
  h.record("traces", ExportResult.retryable("http 503"), t(1000));
  h.record("traces", ExportResult.retryable("http 503"), t(2000));
  h.record("traces", ExportResult.retryable("network ECONNREFUSED"), t(3000));
  assert.deepEqual(h.status(7), { state: "failing", lag: 7, since: "1970-01-01T00:00:01.000Z" });
  h.record("metrics", ExportResult.ok(), t(3500));
  assert.equal(h.status(7).state, "failing", "las métricas no tapan el fallo de las trazas");
  h.record("traces", ExportResult.ok(), t(4000));
  h.record("traces", ExportResult.ok(), t(5000));
  h.record("traces", ExportResult.rejected("http 400"), t(6000));
  h.record("traces", ExportResult.rejected("http 400"), t(7000));
  assert.deepEqual(h.status(0), { state: "ok", lag: 0, since: null });
  assert.deepEqual(lines, [
    'warn otlp export failing; retrying with backoff {"signal":"traces","reason":"http 503"}',
    'warn otlp export failing; retrying with backoff {"signal":"traces","reason":"network ECONNREFUSED"}',
    'info otlp exporter recovered {"signal":"traces","failing_since":"1970-01-01T00:00:01.000Z"}',
    'warn otlp batch rejected and dropped {"signal":"traces","reason":"http 400"}',
  ]);
});

test("trazas: tras un fallo reintentable respeta la espera (1 s, luego 2 s) y se recupera", async () => {
  const { sink, clock, exporter } = world();
  sink.results.push(ExportResult.retryable("http 503"), ExportResult.retryable("http 503"));
  await exporter.tickTraces();
  assert.deepEqual(exporter.status(), { state: "failing", lag: 2, since: "1970-01-01T00:00:00.000Z" });
  clock.ms = 999; await exporter.tickTraces();
  assert.equal(sink.batches.length, 1, "antes de 1 s no se reintenta");
  clock.ms = 1000; await exporter.tickTraces();
  assert.equal(sink.batches.length, 2);
  clock.ms = 2999; await exporter.tickTraces();
  assert.equal(sink.batches.length, 2, "la segunda espera es de 2 s");
  clock.ms = 3000; await exporter.tickTraces();
  assert.equal(sink.batches.length, 3);
  assert.deepEqual(exporter.status(), { state: "ok", lag: 0, since: null });
});

test("una sola pasada a la vez; flush espera a la que está en vuelo y hace una última de trazas y métricas", async () => {
  const { sink, exporter } = world();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const original = sink.sendSpans.bind(sink);
  sink.sendSpans = async (r, s) => { await gate; return original(r, s); };
  const a = exporter.tickTraces(); const b = exporter.tickTraces();
  assert.equal(a, b, "la segunda llamada devuelve la pasada en vuelo");
  release(); await a;
  assert.equal(sink.batches.length, 1);
  await exporter.flush();
  assert.equal(sink.batches.length, 1, "nada nuevo: flush no reenvía");
  assert.equal(sink.metrics.length, 1, "flush manda también el snapshot de métricas");
});

test("métricas: un envío fallido no se encola; el siguiente manda el snapshot nuevo", async () => {
  const { sink, exporter, lines } = world();
  sink.results.push(ExportResult.retryable("timeout"));
  await exporter.tickMetrics();
  await exporter.tickMetrics();
  assert.equal(sink.metrics.length, 2);
  assert.deepEqual(lines, ["otlp export failing; retrying with backoff", "otlp exporter recovered"]);
});

test("un error inesperado del exportador nunca sale: cuenta como fallo reintentable", async () => {
  const { sink, exporter } = world();
  sink.sendSpans = async () => { throw new TypeError("boom"); };
  await exporter.tickTraces();
  assert.equal(exporter.status().state, "failing");
});

test("con atraso encadena pasadas en el mismo tick hasta ponerse al día", async () => {
  const { events, sink, exporter } = world();
  const s2 = StreamId.session(SessionId.of("s2"));
  const facts = [fact("session.opened", "o", {}, s2, 1000)];
  for (let i = 0; i < 600; i++) facts.push(fact("turn.completed", `t${i}`, {}, s2, 2000));
  events.append(s2, StreamVersion.NONE, facts, AT);
  await exporter.tickTraces();
  assert.equal(exporter.status().lag, 0);
  assert.deepEqual(sink.batches.map((b) => b.length), [512, 89]);
});

// R2 (a): un compare-and-set perdido (un rebuild movió el cursor) no es éxito ni fallo.
test("salud: una pasada obsoleta (stale) no cambia el estado ni deja línea", () => {
  const lines: string[] = [];
  const log: HostLog = { info: (m) => { lines.push(m); }, warn: (m) => { lines.push(m); }, error: (m) => { lines.push(m); } };
  const h = new ExporterHealth(log);
  h.record("traces", ExportResult.stale(), t(500));
  assert.deepEqual(h.status(1), { state: "ok", lag: 1, since: null });
  h.record("traces", ExportResult.retryable("http 503"), t(1000));
  h.record("traces", ExportResult.stale(), t(2000));
  assert.deepEqual(h.status(1), { state: "failing", lag: 1, since: "1970-01-01T00:00:01.000Z" });
  h.record("traces", ExportResult.retryable("http 503"), t(3000));
  assert.deepEqual(lines, ["otlp export failing; retrying with backoff"], "tras stale el mismo motivo no se repite");
});

// Un rebuild concurrente: vuelve a 0 un cursor que ya había avanzado.
function racingRebuild(w: ReturnType<typeof world>): () => void {
  const original = w.sink.sendSpans.bind(w.sink);
  w.sink.sendSpans = async (r, s) => { w.store.reset(TraceExport.NAME, TraceExport.VERSION); return original(r, s); };
  return () => { w.sink.sendSpans = original; };
}
const s2 = StreamId.session(SessionId.of("s2"));

test("trazas: si un rebuild gana el compare-and-set, ni se reinicia la espera ni se da por recuperado, y se reintenta en el tick siguiente", async () => {
  const w = world(); const { events, sink, clock, lines, exporter } = w;
  await exporter.tickTraces();
  events.append(s2, StreamVersion.NONE, [fact("session.opened", "o", {}, s2, 1000), fact("session.closed", "x", {}, s2, 1500)], AT);
  sink.results.push(ExportResult.retryable("http 503"));
  await exporter.tickTraces();
  const restore = racingRebuild(w);
  clock.ms = 1000; await exporter.tickTraces();
  assert.equal(sink.batches.length, 3, "una sola pasada: stale corta el encadenado del tick");
  assert.deepEqual(exporter.status(), { state: "failing", lag: 4, since: "1970-01-01T00:00:00.000Z" }, "stale no cuenta como recuperación");
  assert.deepEqual(lines, ["otlp export failing; retrying with backoff"]);
  restore();
  clock.ms = 1001; await exporter.tickTraces();
  assert.equal(sink.batches.length, 4, "sin la espera de 2 s de un segundo fallo");
  assert.deepEqual(exporter.status(), { state: "ok", lag: 0, since: null });
  assert.deepEqual(lines, ["otlp export failing; retrying with backoff", "otlp exporter recovered"]);
});

test("trazas: stale sin fallo previo deja el estado ok, sin líneas, y el tick siguiente reintenta al momento", async () => {
  const w = world(); const { events, sink, lines, exporter } = w;
  await exporter.tickTraces();
  events.append(s2, StreamVersion.NONE, [fact("session.opened", "o", {}, s2, 1000), fact("session.closed", "x", {}, s2, 1500)], AT);
  const restore = racingRebuild(w);
  await exporter.tickTraces();
  assert.deepEqual(exporter.status(), { state: "ok", lag: 4, since: null });
  restore();
  await exporter.tickTraces();
  assert.deepEqual([sink.batches.length, exporter.status().lag, lines.length], [3, 0, 0]);
});

// R2 (b): nunca dos pasadas (trazas o métricas) a la vez.
test("las pasadas de trazas y de métricas se serializan: nunca se solapan", async () => {
  const { sink, exporter } = world();
  let active = 0; let peak = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const spans = sink.sendSpans.bind(sink); const metrics = sink.sendMetrics.bind(sink);
  sink.sendSpans = async (r, s) => { active++; peak = Math.max(peak, active); await gate; active--; return spans(r, s); };
  sink.sendMetrics = async (r, s, a, b) => { active++; peak = Math.max(peak, active); active--; return metrics(r, s, a, b); };
  const tr = exporter.tickTraces(); const me = exporter.tickMetrics();
  await new Promise((r) => setImmediate(r));
  assert.equal(sink.metrics.length, 0, "las métricas esperan a que acabe la pasada de trazas");
  release(); await Promise.all([tr, me]);
  assert.deepEqual([peak, sink.batches.length, sink.metrics.length], [1, 1, 1]);
  assert.equal(exporter.tickMetrics(), exporter.tickMetrics(), "una segunda llamada de métricas devuelve la pendiente");
  await exporter.flush();
});

test("con métricas en vuelo, las trazas esperan su turno", async () => {
  const { sink, exporter } = world();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const metrics = sink.sendMetrics.bind(sink);
  sink.sendMetrics = async (r, s, a, b) => { await gate; return metrics(r, s, a, b); };
  const me = exporter.tickMetrics(); const tr = exporter.tickTraces();
  await new Promise((r) => setImmediate(r));
  assert.equal(sink.batches.length, 0);
  release(); await Promise.all([me, tr]);
  assert.deepEqual([sink.metrics.length, sink.batches.length], [1, 1]);
});

test("un fallo del propio log del host no rompe la cola de pasadas", async () => {
  const { events, store, sink, clock } = world();
  const broken = new TelemetryExporter(
    new TraceExport(events, store, sink, RESOURCE),
    new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock),
    new ExporterHealth({ info: () => { throw new Error("disk full"); }, warn: () => { throw new Error("disk full"); }, error: () => {} }),
    clock);
  sink.results.push(ExportResult.retryable("http 503"));
  sink.sendMetrics = async () => ExportResult.retryable("http 503");
  await broken.tickMetrics();
  await broken.tickTraces();
  assert.equal(sink.batches.length, 1, "la pasada de trazas corre tras el fallo del log en la de métricas");
  assert.equal(broken.status().state, "failing");
});

test("con un log del host que lanza, la espera y la salud se actualizan igual: el estado se asigna antes de registrar", async () => {
  const { events, store, sink, clock } = world();
  const throwing = () => { throw new Error("disk full"); };
  const exporter = new TelemetryExporter(
    new TraceExport(events, store, sink, RESOURCE),
    new MetricsExport(new ReadTelemetryMetrics(events, store), new TelemetryEpochs(new InMemoryTelemetryEpochStore(), clock), sink, RESOURCE, clock),
    new ExporterHealth({ info: throwing, warn: throwing, error: throwing }),
    clock);
  sink.results.push(ExportResult.retryable("http 503"));
  await exporter.tickTraces();
  assert.equal(exporter.status().state, "failing");
  clock.ms = 500; await exporter.tickTraces();
  assert.equal(sink.batches.length, 1, "la espera quedó fijada aunque el aviso lanzara");
  clock.ms = 1000; await exporter.tickTraces();
  assert.equal(sink.batches.length, 2);
  assert.deepEqual(exporter.status(), { state: "ok", lag: 0, since: null }, "la recuperación cuenta aunque su línea lanzara");
});
