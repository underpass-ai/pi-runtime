import type { AppendOutcome } from "../../domain/events/AppendOutcome.ts";
import type { EventId } from "../../domain/events/EventId.ts";
import type { EventRecord } from "../../domain/events/EventRecord.ts";
import type { Fact } from "../../domain/events/Fact.ts";
import type { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { StreamHead } from "../../domain/events/StreamHead.ts";
import type { StreamId } from "../../domain/events/StreamId.ts";
import type { StreamVersion } from "../../domain/events/StreamVersion.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";

export interface EventStore {
  append(stream: StreamId, expected: StreamVersion, facts: Fact[], recordedAt: Timestamp): AppendOutcome;
  importSealed(records: EventRecord[]): number;
  head(stream: StreamId): StreamHead | null;
  find(stream: StreamId, id: EventId): EventRecord | null;
  readStream(stream: StreamId): EventRecord[];
  readAll(after: GlobalPosition, limit: number): StoredEvent[];
  streams(): StreamId[];
  lastPosition(): GlobalPosition;
}
