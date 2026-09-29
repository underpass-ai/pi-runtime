import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../../../../src/adapters/outbound/memory/InMemoryEventStore.ts";
import { EventRecord } from "../../../../src/domain/events/EventRecord.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import type { Fact } from "../../../../src/domain/events/Fact.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { CanonicalJson } from "../../../../src/domain/shared/CanonicalJson.ts";
import type { Span } from "../../../../src/domain/telemetry/Span.ts";
import { SpanAssembler } from "../../../../src/domain/telemetry/SpanAssembler.ts";
import { SpanId } from "../../../../src/domain/telemetry/SpanId.ts";
import { TraceId } from "../../../../src/domain/telemetry/TraceId.ts";
import { SESSION, fact } from "../../../support/recordFixtures.ts";

const RECORDED = 5_000;
const H = StreamId.HOST;
function records(facts: Fact[], stream: StreamId = SESSION): EventRecord[] {
  const store = new InMemoryEventStore();
  store.append(stream, StreamVersion.NONE, facts, Timestamp.fromEpochMs(RECORDED));
  return store.readStream(stream);
}
const fresh = () => new SpanAssembler(SpanAssembler.empty());
const feedAll = (a: SpanAssembler, rs: EventRecord[]) => rs.flatMap((r) => a.feed(r));
const pick = (spans: Span[], name: string, attr?: [string, unknown]) => spans.filter((s) => s.name === name && (attr === undefined || s.attributes.get(attr[0]) === attr[1]));

const SESSION_FACTS = () => [
  fact("session.opened", "o", { reason: "startup", piRuntimeVersion: "0.1.0" }, SESSION, 1000),
  fact("phase.changed", "p", { from: null, to: "interactive", activeTools: 3 }, SESSION, 1100),
  fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1", argsBytes: 12 }, SESSION, 2000),
  fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 400, status: "succeeded", outputBytes: 99 }, SESSION, 2400),
  fact("tool.started", "c2s", { tool: "bash", server: "pi", callId: "c2" }, SESSION, 2500),
  fact("tool.completed", "c2", { tool: "bash", server: "pi", callId: "c2", durationMs: 100, status: "failed", errorKind: "tool_error" }, SESSION, 2600),
  fact("turn.completed", "t1", { model: "m", provider: "p", tokens: { input: 10, output: 3, cacheRead: 1, cacheWrite: 0 }, cost: 0.25, durationMs: 1500, outcome: "completed", stopReason: "toolUse" }, SESSION, 3000),
  fact("tool.started", "c3s", { tool: "kmp_ingest", server: "kmp", callId: "c3" }, SESSION, 3100),
  fact("tool.completed", "c3", { tool: "kmp_ingest", server: "kmp", callId: "c3", durationMs: 100, status: "refused", errorKind: "refused", errorCode: "invalid_argument" }, SESSION, 3200),
  fact("session.closed", "x", { reason: "quit" }, SESSION, 4000),
];

test("empareja tools por callId, las cuelga del turno en curso y el turno de la sesión", () => {
  const rs = records(SESSION_FACTS());
  const a = fresh();
  assert.deepEqual(rs.map((r) => a.feed(r).map((s) => s.name).join(",")), ["", "", "", "", "", "", "turn,tool,tool", "", "", "session,tool"]);
  const spans = feedAll(fresh(), rs);
  assert.ok(spans.every((s) => s.traceId.equals(TraceId.forStream(SESSION))));
  const [session] = pick(spans, "session"); const [turn] = pick(spans, "turn");
  const [ask] = pick(spans, "tool", ["pi_runtime.tool", "kmp_ask"]); const [bash] = pick(spans, "tool", ["pi_runtime.tool", "bash"]);
  const [ingest] = pick(spans, "tool", ["pi_runtime.tool", "kmp_ingest"]);
  assert.ok(session.spanId.equals(SpanId.forEvent(rs[0].id)));
  assert.equal(session.parentId, null);
  assert.deepEqual([session.start.epochMs(), session.end.epochMs()], [1000, 4000]);
  assert.deepEqual(session.events.map((e) => [e.name, e.at.epochMs(), e.attributes.get("pi_runtime.phase.to")]), [["phase.changed", 1100, "interactive"]]);
  assert.deepEqual([session.attributes.get("pi_runtime.close_reason"), session.attributes.get("pi_runtime.session_id"), session.attributes.get("pi_runtime.open_reason")], ["quit", "s1", "startup"]);
  assert.ok(turn.parentId?.equals(session.spanId));
  assert.ok(turn.spanId.equals(SpanId.forEvent(rs[6].id)));
  assert.deepEqual([turn.start.epochMs(), turn.end.epochMs()], [1500, 3000]);
  assert.deepEqual(["pi_runtime.model", "pi_runtime.tokens.input", "pi_runtime.tokens.output", "pi_runtime.cost", "pi_runtime.outcome", "pi_runtime.stop_reason"].map((k) => turn.attributes.get(k)),
    ["m", 10, 3, 0.25, "completed", "toolUse"]);
  assert.ok(ask.parentId?.equals(turn.spanId));
  assert.ok(bash.parentId?.equals(turn.spanId));
  assert.ok(ask.spanId.equals(SpanId.forEvent(rs[2].id)), "el span de la tool lo abre tool.started");
  assert.deepEqual([ask.start.epochMs(), ask.end.epochMs(), ask.status.value, ask.attributes.get("pi_runtime.args_bytes"), ask.attributes.get("pi_runtime.output_bytes")], [2000, 2400, "unset", 12, 99]);
  assert.equal(bash.status.value, "error");
  assert.ok(ingest.parentId?.equals(session.spanId), "sin turno posterior cuelga de la sesión");
  assert.deepEqual([ingest.status.value, ingest.attributes.get("pi_runtime.status"), ingest.attributes.get("pi_runtime.error_code")], ["unset", "refused", "invalid_argument"]);
});

test("una tool sin cierre sale incompleta a los 10 min de recordedAt; un cierre tardío se ignora", () => {
  const rs = records([
    fact("session.opened", "o", {}, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "kmp_ask", server: "kmp", callId: "c1" }, SESSION, 2000),
    fact("tool.started", "c2s", { tool: "kmp_ask", server: "kmp", callId: "c2" }, SESSION, 2100),
    fact("tool.completed", "c1", { tool: "kmp_ask", server: "kmp", callId: "c1", durationMs: 700_000, status: "succeeded" }, SESSION, 702_000),
    fact("session.closed", "x", {}, SESSION, 800_000),
  ]);
  const a = fresh();
  feedAll(a, rs.slice(0, 3));
  assert.deepEqual(a.expire(Timestamp.fromEpochMs(RECORDED + 600_000 - 1)), []);
  const expired = a.expire(Timestamp.fromEpochMs(RECORDED + 600_000));
  assert.equal(expired.length, 2);
  assert.ok(expired.every((s) => s.name === "tool" && s.attributes.get("pi_runtime.incomplete") === true && s.status.value === "unset"));
  assert.deepEqual(expired.map((s) => s.end.epochMs()), [RECORDED + 600_000, RECORDED + 600_000]);
  assert.deepEqual(a.feed(rs[3]), [], "el cierre tardío de c1 se ignora: su span ya salió");
  assert.deepEqual(a.feed(rs[4]).map((s) => s.name), ["session"]);
});

test("al cerrar la sesión las tools abiertas salen incompletas con el fin de la sesión", () => {
  const rs = records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 2000), fact("session.closed", "x", {}, SESSION, 3000)]);
  const [tool] = pick(feedAll(fresh(), rs), "tool");
  assert.deepEqual([tool.start.epochMs(), tool.end.epochMs(), tool.attributes.get("pi_runtime.incomplete")], [2000, 3000, true]);
  assert.ok(tool.spanId.equals(SpanId.forEvent(rs[1].id)));
});

test("una tool cerrada que no ve su turno sale colgada de la sesión a los 10 min; sin tool.started el inicio sale de durationMs", () => {
  const rs = records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.completed", "c9", { tool: "t", server: "pi", callId: "c9", durationMs: 300, status: "succeeded" }, SESSION, 2000)]);
  const a = fresh();
  assert.deepEqual(feedAll(a, rs), []);
  assert.deepEqual(a.expire(Timestamp.fromEpochMs(RECORDED + 599_999)), []);
  const [tool] = a.expire(Timestamp.fromEpochMs(RECORDED + 600_000));
  assert.deepEqual([tool.start.epochMs(), tool.end.epochMs()], [1700, 2000]);
  assert.ok(tool.spanId.equals(SpanId.forEvent(rs[1].id)));
  assert.ok(tool.parentId?.equals(SpanId.forEvent(rs[0].id)));
});

test("una reapertura cierra el span en curso (reopened) y abre otro en la misma traza", () => {
  const rs = records([
    fact("session.opened", "o1", {}, SESSION, 1000),
    fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 1500),
    fact("session.opened", "o2", { reason: "resume" }, SESSION, 2000),
    fact("tool.completed", "c1", { tool: "t", server: "pi", callId: "c1", status: "succeeded" }, SESSION, 2500),
    fact("session.closed", "x", {}, SESSION, 3000),
  ]);
  const a = fresh();
  feedAll(a, rs.slice(0, 2));
  const atReopen = a.feed(rs[2]);
  assert.deepEqual(atReopen.map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.reopened") ?? s.attributes.get("pi_runtime.incomplete")]), [["session", 2000, true], ["tool", 2000, true]]);
  assert.deepEqual(a.feed(rs[3]), [], "la tool ya salió incompleta en la reapertura");
  const [second] = a.feed(rs[4]);
  assert.ok(second.spanId.equals(SpanId.forEvent(rs[2].id)));
  assert.ok(second.traceId.equals(atReopen[0].traceId));
  assert.deepEqual([second.start.epochMs(), second.end.epochMs(), second.attributes.get("pi_runtime.open_reason")], [2000, 3000, "resume"]);
});

test("ids deterministas y reinicio a mitad de lote: el estado serializado continúa igual", () => {
  const rs = records(SESSION_FACTS());
  const whole = feedAll(fresh(), rs).map((s) => s.toJson());
  assert.deepEqual(feedAll(fresh(), records(SESSION_FACTS())).map((s) => s.toJson()), whole);
  for (let cut = 0; cut <= rs.length; cut++) {
    const first = fresh();
    const before = feedAll(first, rs.slice(0, cut));
    const restored = new SpanAssembler(JSON.parse(CanonicalJson.of(first.state()).text));
    assert.deepEqual([...before, ...feedAll(restored, rs.slice(cut))].map((s) => s.toJson()), whole, `corte en ${cut}`);
  }
});

test("un turno con outcome error sale con status ERROR; sin durationMs empieza en su fin", () => {
  const [turn] = feedAll(fresh(), records([fact("session.opened", "o", {}, SESSION, 1000), fact("turn.completed", "t", { outcome: "error" }, SESSION, 2000)]));
  assert.deepEqual([turn.status.value, turn.start.epochMs(), turn.end.epochMs()], ["error", 2000, 2000]);
});

test("model.selected y context.compacted son eventos del span de sesión, con tope de 128", () => {
  const facts = [fact("session.opened", "o", {}, SESSION, 1000), fact("model.selected", "m", { model: "m2", provider: "p", effort: "high" }, SESSION, 1100),
    fact("context.compacted", "k", { tokensBefore: 100, tokensAfter: 10, reason: "threshold" }, SESSION, 1200),
    ...Array.from({ length: 200 }, (_, i) => fact("phase.changed", `p${i}`, { to: "design" }, SESSION, 1300 + i)), fact("session.closed", "x", {}, SESSION, 9000)];
  const [session] = feedAll(fresh(), records(facts));
  assert.equal(session.events.length, 128);
  assert.deepEqual(session.events.slice(0, 2).map((e) => [e.name, e.attributes.toRecord()]), [
    ["model.selected", { "pi_runtime.effort": "high", "pi_runtime.model": "m2", "pi_runtime.provider": "p" }],
    ["context.compacted", { "pi_runtime.reason": "threshold", "pi_runtime.tokens_after": 10, "pi_runtime.tokens_before": 100 }],
  ]);
});

test("host: una traza por arranque, span host hasta host.stopped y spans mcp_server con su código de salida", () => {
  const rs = records([
    fact("host.started", "h1", { version: "0.1.0", pid: 42 }, H, 1000),
    fact("server.started", "s1", { server: "kmp", name: "kmp", version: "1.0.0" }, H, 1100),
    fact("server.exited", "s2", { server: "kmp", code: 0 }, H, 1900),
    fact("server.started", "s3", { server: "made", name: "made", version: "2.0.0" }, H, 2000),
    fact("host.stopped", "h2", { reason: "idle" }, H, 3000),
    fact("host.started", "h3", { version: "0.1.0", pid: 43 }, H, 4000),
    fact("server.started", "s4", { server: "kmp", version: "1.0.0" }, H, 4100),
    fact("server.started", "s5", { server: "kmp", version: "1.0.0" }, H, 4200),
    fact("host.started", "h4", { version: "0.1.1", pid: 44 }, H, 5000),
  ], H);
  const a = fresh();
  const byEvent = rs.map((r) => a.feed(r));
  const run1 = TraceId.forHostRun(rs[0].id);
  const [kmp] = byEvent[2];
  assert.deepEqual([kmp.name, kmp.start.epochMs(), kmp.end.epochMs(), kmp.attributes.get("pi_runtime.exit_code"), kmp.attributes.get("pi_runtime.server")], ["mcp_server", 1100, 1900, 0, "kmp"]);
  assert.ok(kmp.traceId.equals(run1));
  assert.ok(kmp.parentId?.equals(SpanId.forEvent(rs[0].id)));
  const [host, made] = byEvent[4];
  assert.deepEqual([host.name, host.start.epochMs(), host.end.epochMs()], ["host", 1000, 3000]);
  assert.deepEqual(Object.keys(host.attributes.toRecord()), ["pi_runtime.stop_reason", "pi_runtime.version"], "ni pid ni nada de la máquina");
  assert.deepEqual([made.name, made.attributes.get("pi_runtime.incomplete")], ["mcp_server", true]);
  assert.deepEqual(byEvent[7].map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.incomplete")]), [["mcp_server", 4200, true]], "un segundo server.started cierra el anterior");
  const [crashed, stillOpen] = byEvent[8];
  assert.deepEqual([crashed.name, crashed.end.epochMs(), crashed.attributes.get("pi_runtime.incomplete")], ["host", 5000, true]);
  assert.ok(crashed.traceId.equals(TraceId.forHostRun(rs[5].id)));
  assert.equal(crashed.traceId.equals(run1), false);
  assert.deepEqual([stillOpen.name, stillOpen.attributes.get("pi_runtime.incomplete")], ["mcp_server", true]);
});

test("hechos sin sesión o sin host abiertos no emiten nada; flush cierra todo como incompleto", () => {
  const orphan = records([fact("tool.completed", "c", { callId: "c", status: "succeeded" }, SESSION, 1000), fact("turn.completed", "t", {}, SESSION, 1100),
    fact("tool.started", "d", { callId: "d" }, SESSION, 1200), fact("phase.changed", "p", { to: "design" }, SESSION, 1300), fact("session.closed", "x", {}, SESSION, 1400)]);
  assert.deepEqual(feedAll(fresh(), orphan), []);
  const hostOrphan = records([fact("server.exited", "e", { server: "kmp" }, H, 1000), fact("host.stopped", "s", {}, H, 1100), fact("server.started", "x", { server: "kmp" }, H, 1200)], H);
  assert.deepEqual(feedAll(fresh(), hostOrphan), []);
  const a = fresh();
  feedAll(a, records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 1500)]));
  feedAll(a, records([fact("host.started", "h", {}, H, 900), fact("server.started", "s", { server: "kmp" }, H, 950)], H));
  const flushed = a.flush(Timestamp.fromEpochMs(2000));
  assert.deepEqual(flushed.map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.incomplete")]), [["session", 2000, true], ["tool", 2000, true], ["host", 2000, true], ["mcp_server", 2000, true]]);
  assert.deepEqual(a.state(), SpanAssembler.empty());
});

test("entradas malformadas no rompen: callId ausente se ignora, código de salida no entero es unknown y el estado se copia", () => {
  const a = fresh();
  feedAll(a, records([fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c", { tool: "t" }, SESSION, 1100), fact("tool.completed", "d", { status: "succeeded" }, SESSION, 1200)]));
  const snapshot = a.state();
  assert.deepEqual(snapshot.sessions[SESSION.value].tools, {});
  assert.deepEqual(snapshot.sessions[SESSION.value].pending, []);
  snapshot.sessions = {};
  assert.equal(Object.keys(a.state().sessions).length, 1, "state() devuelve una copia");
  const [server] = feedAll(fresh(), records([fact("host.started", "h", {}, H, 900), fact("server.started", "s", {}, H, 950), fact("server.exited", "e", { code: "SIGKILL" }, H, 990)], H));
  assert.deepEqual([server.name, server.attributes.get("pi_runtime.server"), server.attributes.get("pi_runtime.exit_code")], ["mcp_server", "unknown", "unknown"]);
});

const DAY = 24 * 3_600_000;
// Hechos de SESSION grabados en tandas con su propio recordedAt: [[recordedAtMs, facts], …].
function timed(batches: [number, Fact[]][]): EventRecord[] {
  const store = new InMemoryEventStore(); let version = 0;
  for (const [ms, facts] of batches) { store.append(SESSION, StreamVersion.of(version), facts, Timestamp.fromEpochMs(ms)); version += facts.length; }
  return store.readStream(SESSION);
}

test("una sesión sin cierre sale incompleta a las 24 h de su último hecho y sale del estado; un cierre tardío se ignora", () => {
  const rs = timed([
    [RECORDED, [fact("session.opened", "o", { reason: "startup" }, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 1500)]],
    [RECORDED + 3_600_000, [fact("phase.changed", "p", { to: "design" }, SESSION, 3_601_000)]],
    [RECORDED + 2 * DAY, [fact("session.closed", "x", { reason: "quit" }, SESSION, 2 * DAY)]],
  ]);
  const a = fresh();
  feedAll(a, rs.slice(0, 3));
  assert.deepEqual(a.expire(Timestamp.fromEpochMs(RECORDED + 3_600_000 + DAY - 1)).map((s) => s.name), ["tool"], "a las 24 h del inicio sigue viva: hubo actividad después");
  const expired = a.expire(Timestamp.fromEpochMs(RECORDED + 3_600_000 + DAY));
  assert.deepEqual(expired.map((s) => [s.name, s.start.epochMs(), s.end.epochMs(), s.attributes.get("pi_runtime.incomplete"), s.attributes.get("pi_runtime.close_reason")]),
    [["session", 1000, 3_601_000, true, null]], "termina en su último hecho");
  assert.ok(expired[0].spanId.equals(SpanId.forEvent(rs[0].id)));
  assert.deepEqual(expired[0].events.map((e) => e.name), ["phase.changed"]);
  assert.deepEqual(a.state(), SpanAssembler.empty(), "el estado no crece con sesiones abandonadas");
  assert.deepEqual(a.feed(rs[3]), [], "el cierre tardío se ignora: el span ya salió");
});

test("sesión abandonada: el replay del log da los mismos spans que la exportación en vivo", () => {
  const rs = timed([
    [RECORDED, [fact("session.opened", "o", {}, SESSION, 1000), fact("tool.started", "c1s", { tool: "t", server: "pi", callId: "c1" }, SESSION, 1500)]],
    [RECORDED + DAY + 1, [fact("tool.completed", "c1", { tool: "t", server: "pi", callId: "c1", status: "succeeded" }, SESSION, DAY), fact("session.closed", "x", {}, SESSION, DAY + 10)]],
    [RECORDED + DAY + 2, [fact("session.opened", "o2", { reason: "resume" }, SESSION, DAY + 20), fact("session.closed", "x2", {}, SESSION, DAY + 30)]],
  ]);
  // En vivo: el host corre, el exportador expira con el reloj de pared antes de que llegue lo demás.
  const live = fresh();
  const liveSpans = [...feedAll(live, rs.slice(0, 2)), ...live.expire(Timestamp.fromEpochMs(RECORDED + 600_000)), ...live.expire(Timestamp.fromEpochMs(RECORDED + DAY)), ...feedAll(live, rs.slice(2))];
  // Replay (rebuild o host parado durante el hueco): todo el log de una vez y un expire al final.
  const replay = fresh();
  const replaySpans = [...feedAll(replay, rs), ...replay.expire(Timestamp.fromEpochMs(RECORDED + DAY + 2))];
  const shape = (spans: Span[]) => spans.map((s) => s.toJson()).sort((x, y) => (x.spanId < y.spanId ? -1 : 1));
  assert.deepEqual(shape(replaySpans), shape(liveSpans));
  assert.deepEqual(liveSpans.map((s) => [s.name, s.attributes.get("pi_runtime.incomplete")]), [["tool", true], ["session", true], ["session", null]]);
  assert.deepEqual(replay.state(), live.state());
});

test("un estado guardado antes del seguimiento de actividad expira desde el inicio de la sesión", () => {
  const a = fresh();
  feedAll(a, records([fact("session.opened", "o", {}, SESSION, 1000)]));
  const legacy = a.state();
  delete (legacy.sessions[SESSION.value] as { lastRecordedAtMs?: number }).lastRecordedAtMs;
  delete (legacy.sessions[SESSION.value] as { lastMs?: number }).lastMs;
  const restored = new SpanAssembler(legacy);
  assert.deepEqual(restored.expire(Timestamp.fromEpochMs(1000 + DAY - 1)), []);
  assert.deepEqual(restored.expire(Timestamp.fromEpochMs(1000 + DAY)).map((s) => [s.name, s.end.epochMs()]), [["session", 1000]]);
});

// La auditoría de MADE y los tipos opacos los registra el host (o una versión futura): no son
// actividad de Pi, así que ni alargan la vida de la sesión ni mueven su fin.
test("un hecho made.* o de tipo opaco no cuenta como actividad de la sesión para el abandono", () => {
  const rs = timed([
    [RECORDED, [fact("session.opened", "o", {}, SESSION, 1000)]],
    [RECORDED + 3_600_000, [fact("made.grant_issued", "grant.x", { grantId: "x" }, SESSION, 3_601_000)]],
    [RECORDED + 7_200_000, [fact("made.confirmation", "confirm.x", { outcome: "accepted" }, SESSION, 7_201_000)]],
  ]);
  const last = rs.at(-1)!;
  const opaque = EventRecord.restore({ ...last, id: last.id, type: EventType.stored("future.thing"), recordedAt: Timestamp.fromEpochMs(RECORDED + 10_800_000), occurredAt: Timestamp.fromEpochMs(10_801_000) });
  const a = fresh();
  assert.deepEqual(feedAll(a, [...rs, opaque]), [], "ni eventos ni spans");
  const expired = a.expire(Timestamp.fromEpochMs(RECORDED + DAY));
  assert.deepEqual(expired.map((s) => [s.name, s.end.epochMs(), s.attributes.get("pi_runtime.incomplete")]), [["session", 1000, true]], "abandonada a las 24 h del último hecho de Pi");
  assert.deepEqual(expired[0].events, []);
});
