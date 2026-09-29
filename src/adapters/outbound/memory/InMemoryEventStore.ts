import type { EventStore } from "../../../application/ports/EventStore.ts";
import type { AppendOutcome } from "../../../domain/events/AppendOutcome.ts";
import { AppendPlanner } from "../../../domain/events/AppendPlanner.ts";
import type { EventId } from "../../../domain/events/EventId.ts";
import type { EventRecord } from "../../../domain/events/EventRecord.ts";
import type { Fact } from "../../../domain/events/Fact.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ImportPlanner } from "../../../domain/events/ImportPlanner.ts";
import { StoredEvent } from "../../../domain/events/StoredEvent.ts";
import { StreamHead } from "../../../domain/events/StreamHead.ts";
import { StreamId } from "../../../domain/events/StreamId.ts";
import type { StreamVersion } from "../../../domain/events/StreamVersion.ts";
import type { Timestamp } from "../../../domain/events/Timestamp.ts";

export class InMemoryEventStore implements EventStore {
  readonly #all: StoredEvent[] = [];
  readonly #streams = new Map<string, EventRecord[]>();

  append(stream: StreamId, expected: StreamVersion, facts: Fact[], recordedAt: Timestamp): AppendOutcome {
    const plan = AppendPlanner.plan(this.head(stream), (id) => this.find(stream, id), expected, facts, recordedAt);
    this.#write(plan.toWrite);
    return plan.outcome;
  }

  importSealed(records: EventRecord[]): number {
    const toWrite = ImportPlanner.plan((s) => this.readStream(s), records);
    this.#write(toWrite);
    return toWrite.length;
  }

  head(stream: StreamId): StreamHead | null {
    const last = this.#streams.get(stream.value)?.at(-1);
    return last === undefined ? null : StreamHead.of({ stream, version: last.version, hash: last.hash, lastEventId: last.id, correlationId: last.correlationId });
  }

  find(stream: StreamId, id: EventId): EventRecord | null { return this.#streams.get(stream.value)?.find((r) => r.id.equals(id)) ?? null; }
  readStream(stream: StreamId): EventRecord[] { return [...(this.#streams.get(stream.value) ?? [])]; }
  readAll(after: GlobalPosition, limit: number): StoredEvent[] { return this.#all.filter((e) => e.position.value > after.value).slice(0, limit); }
  streams(): StreamId[] { return [...this.#streams.keys()].map((s) => StreamId.of(s)); }
  lastPosition(): GlobalPosition { return this.#all.at(-1)?.position ?? GlobalPosition.START; }

  #write(records: EventRecord[]): void {
    for (const r of records) {
      this.#streams.set(r.stream.value, [...(this.#streams.get(r.stream.value) ?? []), r]);
      this.#all.push(StoredEvent.of(GlobalPosition.of(this.#all.length + 1), r));
    }
  }
}
