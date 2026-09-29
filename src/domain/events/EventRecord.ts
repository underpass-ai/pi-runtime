import type { CanonicalJson } from "../shared/CanonicalJson.ts";
import type { Actor } from "./Actor.ts";
import type { EventHash } from "./EventHash.ts";
import type { EventId } from "./EventId.ts";
import type { EventType } from "./EventType.ts";
import type { Fact } from "./Fact.ts";
import type { StreamId } from "./StreamId.ts";
import type { StreamVersion } from "./StreamVersion.ts";
import type { Timestamp } from "./Timestamp.ts";
import type { TypeVersion } from "./TypeVersion.ts";

type Props = {
  id: EventId; stream: StreamId; version: StreamVersion; type: EventType; typeVersion: TypeVersion; occurredAt: Timestamp; recordedAt: Timestamp;
  actor: Actor; correlationId: EventId; causationId: EventId | null; payload: CanonicalJson; prevHash: EventHash | null; hash: EventHash;
};

export class EventRecord {
  readonly id: EventId; readonly stream: StreamId; readonly version: StreamVersion; readonly type: EventType; readonly typeVersion: TypeVersion;
  readonly occurredAt: Timestamp; readonly recordedAt: Timestamp; readonly actor: Actor; readonly correlationId: EventId;
  readonly causationId: EventId | null; readonly payload: CanonicalJson; readonly prevHash: EventHash | null; readonly hash: EventHash;
  private constructor(p: Props) {
    this.id = p.id; this.stream = p.stream; this.version = p.version; this.type = p.type; this.typeVersion = p.typeVersion;
    this.occurredAt = p.occurredAt; this.recordedAt = p.recordedAt; this.actor = p.actor; this.correlationId = p.correlationId;
    this.causationId = p.causationId; this.payload = p.payload; this.prevHash = p.prevHash; this.hash = p.hash;
  }
  static restore(p: Props): EventRecord { return new EventRecord(p); }
  matches(f: Fact): boolean {
    return this.id.equals(f.id) && this.stream.equals(f.stream) && this.type.equals(f.type) && this.typeVersion.equals(f.typeVersion)
      && this.occurredAt.equals(f.occurredAt) && this.actor.equals(f.actor) && this.payload.equals(f.payload);
  }
}
