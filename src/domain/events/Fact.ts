import { DomainError } from "../shared/DomainError.ts";
import type { CanonicalJson } from "../shared/CanonicalJson.ts";
import type { Actor } from "./Actor.ts";
import type { EventId } from "./EventId.ts";
import type { EventType } from "./EventType.ts";
import type { StreamId } from "./StreamId.ts";
import type { Timestamp } from "./Timestamp.ts";
import type { TypeVersion } from "./TypeVersion.ts";

type Props = { id: EventId; stream: StreamId; type: EventType; typeVersion: TypeVersion; occurredAt: Timestamp; actor: Actor; payload: CanonicalJson };

export class Fact {
  readonly id: EventId; readonly stream: StreamId; readonly type: EventType; readonly typeVersion: TypeVersion;
  readonly occurredAt: Timestamp; readonly actor: Actor; readonly payload: CanonicalJson;
  private constructor(p: Props) { this.id = p.id; this.stream = p.stream; this.type = p.type; this.typeVersion = p.typeVersion; this.occurredAt = p.occurredAt; this.actor = p.actor; this.payload = p.payload; }
  static of(p: Props): Fact {
    if (p.type.belongsToSessions() !== p.stream.isSession()) throw DomainError.because(`${p.type.value} cannot be recorded on stream ${p.stream.value}`);
    return new Fact(p);
  }
}
