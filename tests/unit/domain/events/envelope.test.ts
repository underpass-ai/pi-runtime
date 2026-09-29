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
  assert.throws(() => TypeVersion.of(0), DomainError);
  assert.equal(StreamVersion.NONE.next().value, 1);
  assert.throws(() => StreamVersion.of(-1), DomainError);
  assert.throws(() => StreamVersion.of(1.5), DomainError);
  assert.equal(GlobalPosition.START.value, 0);
});

test("timestamps ISO con milisegundos", () => {
  const t = Timestamp.fromEpochMs(0);
  assert.equal(t.value, "1970-01-01T00:00:00.000Z");
  assert.equal(Timestamp.parse("2026-09-29T10:00:00.123Z").epochMs(), Date.UTC(2026, 8, 29, 10, 0, 0, 123));
  assert.throws(() => Timestamp.parse("2026-09-29"), DomainError);
  assert.throws(() => Timestamp.fromEpochMs(Number.NaN), DomainError);
});

test("actor, about, id derivado y hash", () => {
  const a = Actor.of("agent", "pi:42");
  assert.ok(a.equals(Actor.of("agent", "pi:42")));
  assert.throws(() => Actor.of("robot", "x"), DomainError);
  assert.throws(() => Actor.of("host", ""), DomainError);
  const id = EventId.derive(StreamId.HOST, EventType.of("host.started"), EventAbout.of("42.1000.0"));
  assert.equal(id.value, "host:host.started:42.1000.0");
  assert.throws(() => EventAbout.of("with space"), DomainError);
  assert.throws(() => EventHash.of("zz"), DomainError);
});

test("los VOs de cadena rechazan entradas que no son string", () => {
  for (const f of [() => SessionId.of(undefined as never), () => StreamId.of(undefined as never), () => EventType.of(undefined as never), () => EventAbout.of(undefined as never), () => EventId.of(undefined as never), () => EventHash.of(undefined as never), () => Timestamp.parse(undefined as never)]) {
    assert.throws(f, DomainError);
  }
});
