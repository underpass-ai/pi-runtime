import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";
import { Span } from "../../../../src/domain/telemetry/Span.ts";
import { SpanAttributes } from "../../../../src/domain/telemetry/SpanAttributes.ts";
import { SpanEvent } from "../../../../src/domain/telemetry/SpanEvent.ts";
import { SpanId } from "../../../../src/domain/telemetry/SpanId.ts";
import { SpanStatus } from "../../../../src/domain/telemetry/SpanStatus.ts";
import { TelemetryDigest } from "../../../../src/domain/telemetry/TelemetryDigest.ts";
import { TraceId } from "../../../../src/domain/telemetry/TraceId.ts";
import { SESSION } from "../../../support/recordFixtures.ts";

const framed = (...parts: string[]) => createHash("sha256").update(parts.map((p) => `${Buffer.byteLength(p)}:${p}`).join("")).digest("hex");

test("ids deterministas: traza por stream (host: por arranque) y span por el event_id que lo abre", () => {
  assert.equal(TraceId.forStream(SESSION).value, framed("pi-runtime.trace", "session:s1").slice(0, 32));
  const started = EventId.of("host:host.started:42.1000.0");
  assert.equal(TraceId.forHostRun(started).value, framed("pi-runtime.trace", "host", started.value).slice(0, 32));
  assert.notEqual(TraceId.forHostRun(started).value, TraceId.forStream(StreamId.HOST).value);
  const opened = EventId.of("session:s1:session.opened:opened.1000");
  assert.equal(SpanId.forEvent(opened).value, framed("pi-runtime.span", opened.value).slice(0, 16));
  assert.ok(SpanId.forEvent(opened).equals(SpanId.forEvent(EventId.of(opened.value))));
  assert.equal(TelemetryDigest.hex("d", "a", "bc"), framed("d", "a", "bc"));
  assert.notEqual(TelemetryDigest.hex("d", "ab", "c"), TelemetryDigest.hex("d", "a", "bc"), "el encuadre evita ambigüedades");
  for (const bad of ["", "0".repeat(32), "A".repeat(32), "abc"]) assert.throws(() => TraceId.of(bad), DomainError);
  for (const bad of ["", "0".repeat(16), "xyz"]) assert.throws(() => SpanId.of(bad), DomainError);
  assert.throws(() => TraceId.of(undefined as never), DomainError);
  assert.throws(() => SpanId.of(undefined as never), DomainError);
});

test("atributos: ordenados, sin nulos ni no finitos, textos recortados y claves validadas", () => {
  const a = SpanAttributes.of({ "pi_runtime.tool": "kmp_ask", "a.b": 1, skip: null, gone: undefined, nan: Number.NaN, flag: true, long: "x".repeat(300) });
  assert.deepEqual(a.entries().map(([k]) => k), ["a.b", "flag", "long", "pi_runtime.tool"]);
  assert.equal((a.get("long") as string).length, 256);
  assert.equal(a.get("nope"), null);
  assert.deepEqual(SpanAttributes.NONE.toRecord(), {});
  assert.throws(() => SpanAttributes.of({ "Bad Key": 1 }), DomainError);
  assert.throws(() => SpanAttributes.of({ k: {} as never }), DomainError);
});

test("span: fin nunca anterior al inicio, JSON reversible y nombres cerrados", () => {
  const t = TraceId.forStream(SESSION); const id = SpanId.forEvent(EventId.of("e1"));
  const s = Span.of({ traceId: t, spanId: id, parentId: null, name: "session", start: Timestamp.fromEpochMs(2000), end: Timestamp.fromEpochMs(1000), status: SpanStatus.UNSET,
    attributes: SpanAttributes.of({ "pi_runtime.reopened": true }), events: [SpanEvent.of("phase.changed", Timestamp.fromEpochMs(1500), SpanAttributes.of({ "pi_runtime.phase.to": "design" }))] });
  assert.equal(s.durationMs(), 0);
  const json = s.toJson();
  assert.deepEqual(json, { traceId: t.value, spanId: id.value, parentId: null, name: "session", startMs: 2000, endMs: 2000, status: "unset",
    attributes: { "pi_runtime.reopened": true }, events: [{ name: "phase.changed", atMs: 1500, attributes: { "pi_runtime.phase.to": "design" } }] });
  assert.deepEqual(Span.fromJson(json).toJson(), json);
  const child = Span.fromJson({ ...json, name: "tool", parentId: id.value, status: "error", events: [] });
  assert.ok(child.parentId?.equals(id));
  assert.ok(child.status.isError());
  assert.equal(SpanStatus.UNSET.isError(), false);
  assert.throws(() => Span.fromJson({ ...json, name: "prompt" }), DomainError);
  assert.throws(() => SpanEvent.of("tool.started", Timestamp.fromEpochMs(0), SpanAttributes.NONE), DomainError);
  assert.throws(() => SpanStatus.of("ok"), DomainError);
  assert.ok(SpanStatus.of("unset").equals(SpanStatus.UNSET));
  assert.ok(SpanStatus.of("error").equals(SpanStatus.ERROR));
});
