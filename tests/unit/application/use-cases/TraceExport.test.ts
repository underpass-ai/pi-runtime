import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { InMemoryProjectionStore } from "../../../../src/adapters/outbound/memory/InMemoryProjectionStore.ts";
import type { EventStore } from "../../../../src/application/ports/EventStore.ts";
import { TraceExport } from "../../../../src/application/use-cases/TraceExport.ts";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { TelemetryInstanceId } from "../../../../src/domain/telemetry/TelemetryInstanceId.ts";
import { ExportResult } from "../../../../src/domain/telemetry/ExportResult.ts";
import type { Span } from "../../../../src/domain/telemetry/Span.ts";
import { TelemetryResource } from "../../../../src/domain/telemetry/TelemetryResource.ts";
import { TraceId } from "../../../../src/domain/telemetry/TraceId.ts";
import { FakeTelemetrySink } from "../../../support/FakeTelemetrySink.ts";
import { AT, SESSION, fact } from "../../../support/recordFixtures.ts";

const RESOURCE = TelemetryResource.of("0.1.0", TelemetryInstanceId.of("0123456789abcdef"));
const NOW = Timestamp.fromEpochMs(10_000);

function session(events: EventStore, calls = 1): void {
  const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
  for (let i = 0; i < calls; i++) facts.push(
    fact("tool.started", `c${i}s`, { tool: "kmp_ask", server: "kmp", callId: `c${i}` }, SESSION, 2000),
    fact("tool.completed", `c${i}`, { tool: "kmp_ask", server: "kmp", callId: `c${i}`, durationMs: 5, status: "succeeded" }, SESSION, 2005),
    fact("turn.completed", `t${i}`, { durationMs: 10 }, SESSION, 2010));
  facts.push(fact("session.closed", "x", {}, SESSION, 3000));
  events.append(SESSION, StreamVersion.NONE, facts, AT);
}
function setup() {
  const events = new InMemoryEventStore(); const store = new InMemoryProjectionStore(); const sink = new FakeTelemetrySink();
  return { events, store, sink, exporter: new TraceExport(events, store, sink, RESOURCE) };
}
const ids = (batches: Span[][]) => batches.flat().map((s) => s.spanId.value);

test("envía los spans ensamblados y sólo avanza el cursor tras un 2xx", async () => {
  const { events, store, sink, exporter } = setup();
  session(events);
  assert.equal(exporter.lag(), 5);
  assert.equal((await exporter.execute(NOW)).kind, "ok");
  assert.deepEqual(sink.batches.map((b) => b.map((s) => s.name)), [["turn", "tool", "session"]]);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 5);
  assert.equal(exporter.lag(), 0);
  await exporter.execute(NOW);
  assert.equal(sink.batches.length, 1, "sin nada nuevo no se envía nada");
});

test("un 5xx, 429 o error de red no avanza el cursor y el reintento envía los mismos ids", async () => {
  const { events, store, sink, exporter } = setup();
  session(events);
  sink.results.push(ExportResult.retryable("http 503"));
  assert.deepEqual(await exporter.execute(NOW), ExportResult.retryable("http 503"));
  assert.equal(exporter.lag(), 5);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 0);
  assert.equal((await exporter.execute(NOW)).kind, "ok");
  assert.deepEqual(ids([sink.batches[1]]), ids([sink.batches[0]]));
  assert.equal(exporter.lag(), 0);
});

test("un 4xx (que no es 429) descarta el lote con aviso y avanza", async () => {
  const { events, sink, exporter } = setup();
  session(events);
  sink.results.push(ExportResult.rejected("http 400"));
  const r = await exporter.execute(NOW);
  assert.deepEqual([r.kind, r.reason], ["rejected", "http 400"]);
  assert.equal(exporter.lag(), 0);
  await exporter.execute(NOW);
  assert.equal(sink.batches.length, 1);
});

test("lotes de hasta 512 spans: un hecho que suelta muchos se trocea", async () => {
  const { events, sink, exporter } = setup();
  const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
  for (let i = 0; i < 600; i++) facts.push(fact("tool.completed", `c${i}`, { tool: "t", server: "pi", callId: `c${i}`, status: "succeeded" }, SESSION, 2000));
  facts.push(fact("turn.completed", "t", {}, SESSION, 3000));
  events.append(SESSION, StreamVersion.NONE, facts, AT);
  await exporter.execute(NOW);
  assert.deepEqual(sink.batches.map((b) => b.length), [512, 89]);
  assert.equal(new Set(ids(sink.batches)).size, 601);
});

test("con mucho atraso cada pasada envía ≤ 512 y un exportador nuevo (reinicio) sigue donde iba sin duplicar", async () => {
  const { events, store, sink, exporter } = setup();
  session(events, 600);
  await exporter.execute(NOW);
  assert.equal(sink.batches[0].length, 512);
  assert.ok(exporter.lag() > 0);
  const restarted = new TraceExport(events, store, sink, RESOURCE);
  while (restarted.lag() > 0) await restarted.execute(NOW);
  assert.deepEqual(sink.batches.map((b) => b.length), [512, 512, 177]);
  assert.equal(new Set(ids(sink.batches)).size, 600 * 2 + 1);
});

test("los incompletos por tiempo salen aunque no haya eventos nuevos", async () => {
  const { events, sink, exporter } = setup();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 2000)], AT);
  await exporter.execute(NOW);
  assert.equal(sink.batches.length, 0, "no hay nada cerrado todavía");
  assert.equal(exporter.lag(), 0, "pero el estado y el cursor sí avanzan");
  await exporter.execute(Timestamp.fromEpochMs(AT.epochMs() + 600_000));
  assert.deepEqual(sink.batches.map((b) => b.map((s) => [s.name, s.attributes.get("pi_runtime.incomplete")])), [[["tool", true]]]);
});

test("reexportar tras reiniciar el cursor produce los mismos ids; un cursor de otra versión se reinicia solo", async () => {
  const { events, store, sink, exporter } = setup();
  session(events, 3);
  await exporter.execute(NOW);
  const first = ids([sink.batches[0]]).sort();
  store.reset(TraceExport.NAME, TraceExport.VERSION);
  await exporter.execute(NOW);
  store.reset(TraceExport.NAME, 99);
  assert.equal(exporter.lag(), 3 * 3 + 2, "un cursor de otra versión cuenta desde el principio");
  await exporter.execute(NOW);
  assert.deepEqual(ids([sink.batches[1]]).sort(), first);
  assert.deepEqual(ids([sink.batches[2]]).sort(), first);
});

// Requisito (a) de la revisión de Task 5: estado del ensamblador y cursor van en el mismo compare-and-set.
test("el estado del ensamblador viaja con el cursor: un reinicio con una tool abierta la cierra completa", async () => {
  const { events, store, sink, exporter } = setup();
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1", argsBytes: 7 }, SESSION, 2000)], AT);
  await exporter.execute(NOW);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 2);
  events.append(SESSION, StreamVersion.of(2), [fact("tool.completed", "c1", { tool: "t", server: "pi", callId: "c1", status: "succeeded" }, SESSION, 2500), fact("session.closed", "x", {}, SESSION, 3000)], AT);
  await new TraceExport(events, store, sink, RESOURCE).execute(NOW);
  const tool = sink.batches.flat().find((s) => s.name === "tool");
  assert.ok(tool);
  assert.deepEqual([tool.start.epochMs(), tool.attributes.get("pi_runtime.args_bytes"), tool.attributes.get("pi_runtime.incomplete")], [2000, 7, null]);
});

test("si otro escritor reinicia el cursor mientras se envía, el commit no escribe ni cursor ni estado y la pasada siguiente reenvía los mismos ids", async () => {
  const { events, store, sink } = setup();
  const racing = new FakeTelemetrySink();
  let race = false;
  racing.sendSpans = async (resource, spans) => {
    if (race) { race = false; store.reset(TraceExport.NAME, TraceExport.VERSION); }
    return sink.sendSpans(resource, spans);
  };
  const exporter = new TraceExport(events, store, racing, RESOURCE);
  events.append(SESSION, StreamVersion.NONE, [fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 2000)], AT);
  await exporter.execute(NOW);
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 2);
  events.append(SESSION, StreamVersion.of(2), [fact("tool.completed", "c1", { tool: "t", server: "pi", callId: "c1", status: "succeeded" }, SESSION, 2500), fact("session.closed", "x", {}, SESSION, 3000)], AT);
  race = true;
  assert.deepEqual(await exporter.execute(NOW), ExportResult.stale(), "un compare-and-set perdido es stale, no ok");
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 0, "el rebuild gana: el cursor no avanza");
  assert.equal(store.load(TraceExport.NAME).size, 0, "ni se escribe el estado del ensamblador");
  await exporter.execute(NOW);
  assert.deepEqual(ids([sink.batches[1]]), ids([sink.batches[0]]));
  assert.equal(exporter.lag(), 0);
});

// Requisito (b): con atraso pendiente no se expira con el reloj de pared.
test("con atraso sin leer no se expira por reloj de pared: una tool cuyo cierre aún no se ha leído sale completa", async () => {
  const { events, sink, exporter } = setup();
  const other = StreamId.session(SessionId.of("s2"));
  events.append(other, StreamVersion.NONE, [fact("session.opened", "o2", {}, other, 1000), fact("tool.started", "long-s", { tool: "t", server: "pi", callId: "long" }, other, 1500)], AT);
  session(events, 300);
  events.append(other, StreamVersion.of(2), [
    fact("tool.completed", "long", { tool: "t", server: "pi", callId: "long", status: "succeeded" }, other, 1600),
    fact("session.closed", "x2", {}, other, 3000)], AT);
  const late = Timestamp.fromEpochMs(AT.epochMs() + 20 * 60_000);
  await exporter.execute(late);
  assert.ok(exporter.lag() > 0, "la primera pasada se corta en 512 con atraso pendiente");
  while (exporter.lag() > 0) await exporter.execute(late);
  const trace = TraceId.forStream(other).value;
  const tools = sink.batches.flat().filter((s) => s.traceId.value === trace && s.name === "tool");
  assert.deepEqual(tools.map((s) => [s.attributes.get("pi_runtime.status"), s.attributes.get("pi_runtime.incomplete")]), [["succeeded", null]]);
});

test("con atraso, lo que lleva 10 min sin cierre según el propio log sí expira", async () => {
  const { events, sink, exporter } = setup();
  const other = StreamId.session(SessionId.of("s2"));
  events.append(other, StreamVersion.NONE, [fact("session.opened", "o2", {}, other, 1000), fact("tool.started", "long-s", { tool: "t", server: "pi", callId: "long" }, other, 1500)], AT);
  const facts = [fact("session.opened", "o", {}, SESSION, 1000)];
  for (let i = 0; i < 600; i++) facts.push(fact("tool.completed", `c${i}`, { tool: "t", server: "pi", callId: `c${i}`, status: "succeeded" }, SESSION, 2000), fact("turn.completed", `t${i}`, {}, SESSION, 2000));
  events.append(SESSION, StreamVersion.NONE, facts, Timestamp.fromEpochMs(AT.epochMs() + 11 * 60_000));
  await exporter.execute(NOW);
  assert.ok(exporter.lag() > 0);
  const trace = TraceId.forStream(other).value;
  assert.deepEqual(sink.batches.flat().filter((s) => s.traceId.value === trace).map((s) => [s.name, s.attributes.get("pi_runtime.incomplete")]), [["tool", true]]);
});

test("un lote descartado (4xx) cuyo compare-and-set pierde también es stale, no rejected", async () => {
  const { events, store, sink } = setup();
  const racing = new FakeTelemetrySink();
  racing.sendSpans = async (resource, spans) => { store.reset(TraceExport.NAME, TraceExport.VERSION); await sink.sendSpans(resource, spans); return ExportResult.rejected("http 400"); };
  session(events);
  assert.equal((await new TraceExport(events, store, sink, RESOURCE).execute(NOW)).kind, "ok");
  const s2 = StreamId.session(SessionId.of("s2"));
  events.append(s2, StreamVersion.NONE, [fact("session.opened", "o", {}, s2, 1000), fact("session.closed", "x", {}, s2, 1500)], AT);
  assert.deepEqual(await new TraceExport(events, store, racing, RESOURCE).execute(NOW), ExportResult.stale());
  assert.equal(store.cursor(TraceExport.NAME)?.position.value, 0, "el rebuild gana");
});
