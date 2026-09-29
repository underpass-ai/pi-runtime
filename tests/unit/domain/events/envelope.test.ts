import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionId } from "../../../../src/domain/events/SessionId.ts";
import { StreamId } from "../../../../src/domain/events/StreamId.ts";
import { EventType } from "../../../../src/domain/events/EventType.ts";
import { TypeVersion } from "../../../../src/domain/events/TypeVersion.ts";
import { StreamVersion } from "../../../../src/domain/events/StreamVersion.ts";
import { GlobalPosition } from "../../../../src/domain/events/GlobalPosition.ts";
import { Timestamp } from "../../../../src/domain/events/Timestamp.ts";
import { Actor } from "../../../../src/domain/events/Actor.ts";
import { EventAbout } from "../../../../src/domain/events/EventAbout.ts";
import { EventId } from "../../../../src/domain/events/EventId.ts";
import { EventHash } from "../../../../src/domain/events/EventHash.ts";
import { DomainError } from "../../../../src/domain/shared/DomainError.ts";

test("streams: host y session:<id>", () => {
  const s = StreamId.session(SessionId.of("019a-abc"));
  assert.equal(s.value, "session:019a-abc");
  assert.ok(s.isSession());
  assert.equal(s.sessionId().value, "019a-abc");
  assert.ok(StreamId.of("host").equals(StreamId.HOST));
  assert.ok(StreamId.of("session:019a-abc").equals(s));
  assert.throws(() => StreamId.HOST.sessionId(), DomainError);
  assert.throws(() => StreamId.of("other"), DomainError);
  assert.throws(() => SessionId.of("a b"), DomainError);
});

test("tipos, versiones y posiciones", () => {
  assert.ok(EventType.of("tool.completed").belongsToSessions());
  assert.equal(EventType.of("server.started").belongsToSessions(), false);
  assert.throws(() => EventType.of("tool.exploded"), DomainError);
  assert.equal(TypeVersion.V1.value, 1);
  assert.equal(TypeVersion.of(2).value, 2);
  assert.throws(() => TypeVersion.of(0), DomainError);
  assert.throws(() => TypeVersion.of(1001), DomainError);
  assert.equal(StreamVersion.NONE.next().value, 1);
  assert.equal(StreamVersion.of(3).value, 3);
  assert.throws(() => StreamVersion.of(-1), DomainError);
  assert.throws(() => StreamVersion.of(1.5), DomainError);
  assert.equal(GlobalPosition.START.value, 0);
  assert.equal(GlobalPosition.of(5).value, 5);
  assert.throws(() => GlobalPosition.of(-1), DomainError);
  assert.throws(() => GlobalPosition.of(1.5), DomainError);
});

test("timestamps ISO con milisegundos", () => {
  const t = Timestamp.fromEpochMs(0);
  assert.equal(t.value, "1970-01-01T00:00:00.000Z");
  assert.equal(Timestamp.parse("2026-09-29T10:00:00.123Z").epochMs(), Date.UTC(2026, 8, 29, 10, 0, 0, 123));
  assert.throws(() => Timestamp.parse("2026-09-29"), DomainError);
  assert.throws(() => Timestamp.fromEpochMs(Number.NaN), DomainError);
});

test("fromEpochMs exige un entero en [0, 9999-12-31T23:59:59.999Z]: lo que produce siempre se puede volver a leer", () => {
  const max = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
  assert.equal(Timestamp.fromEpochMs(max).value, "9999-12-31T23:59:59.999Z");
  assert.equal(Timestamp.parse(Timestamp.fromEpochMs(max).value).epochMs(), max);
  for (const bad of [1e15, max + 1, 1.5, -1, Infinity, "5" as unknown as number]) assert.throws(() => Timestamp.fromEpochMs(bad), DomainError);
});

test("actor, about, id derivado y hash", () => {
  const a = Actor.of("agent", "pi:42");
  assert.ok(a.equals(Actor.of("agent", "pi:42")));
  assert.throws(() => Actor.of("robot", "x"), DomainError);
  assert.throws(() => Actor.of("host", ""), DomainError);
  const id = EventId.derive(StreamId.HOST, EventType.of("host.started"), EventAbout.of("42.1000.0"));
  assert.equal(id.value, "host:host.started:42.1000.0");
  assert.equal(EventId.of("x:y").value, "x:y");
  assert.throws(() => EventId.of("x y"), DomainError);
  assert.throws(() => EventAbout.of("with space"), DomainError);
  const hex = "a".repeat(64);
  assert.equal(EventHash.of(hex).value, hex);
  assert.throws(() => EventHash.of("zz"), DomainError);
  assert.throws(() => EventHash.of("A".repeat(64)), DomainError);
});

test("los VOs de cadena rechazan entradas que no son string", () => {
  for (const f of [() => SessionId.of(undefined as never), () => StreamId.of(undefined as never), () => EventType.of(undefined as never), () => EventAbout.of(undefined as never), () => EventId.of(undefined as never), () => EventHash.of(undefined as never), () => Timestamp.parse(undefined as never)]) {
    assert.throws(f, DomainError);
  }
});
