import { Actor } from "../../src/domain/events/Actor.ts";
import { EventAbout } from "../../src/domain/events/EventAbout.ts";
import { EventId } from "../../src/domain/events/EventId.ts";
import { EventType } from "../../src/domain/events/EventType.ts";
import { Fact } from "../../src/domain/events/Fact.ts";
import { SessionId } from "../../src/domain/events/SessionId.ts";
import { StreamId } from "../../src/domain/events/StreamId.ts";
import { Timestamp } from "../../src/domain/events/Timestamp.ts";
import { TypeVersion } from "../../src/domain/events/TypeVersion.ts";
import { CanonicalJson } from "../../src/domain/shared/CanonicalJson.ts";

export const SESSION = StreamId.session(SessionId.of("s1"));
export const AGENT = Actor.of("agent", "pi:1");

export function fact(type: string, about: string, payload: Record<string, unknown> = {}, stream: StreamId = SESSION, ms = 1_000): Fact {
  const t = EventType.of(type);
  return Fact.of({ id: EventId.derive(stream, t, EventAbout.of(about)), stream, type: t, typeVersion: TypeVersion.V1, occurredAt: Timestamp.fromEpochMs(ms), actor: stream.isSession() ? AGENT : Actor.of("host", "h1"), payload: CanonicalJson.of(payload) });
}

export const AT = Timestamp.fromEpochMs(5_000);
