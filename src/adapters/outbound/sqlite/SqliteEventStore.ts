import type { EventStore } from "../../../application/ports/EventStore.ts";
import { Actor } from "../../../domain/events/Actor.ts";
import type { AppendOutcome } from "../../../domain/events/AppendOutcome.ts";
import { AppendPlanner } from "../../../domain/events/AppendPlanner.ts";
import { EventHash } from "../../../domain/events/EventHash.ts";
import { EventId } from "../../../domain/events/EventId.ts";
import { EventRecord } from "../../../domain/events/EventRecord.ts";
import { EventType } from "../../../domain/events/EventType.ts";
import type { Fact } from "../../../domain/events/Fact.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ImportPlanner } from "../../../domain/events/ImportPlanner.ts";
import { StoredEvent } from "../../../domain/events/StoredEvent.ts";
import { StreamHead } from "../../../domain/events/StreamHead.ts";
import { StreamId } from "../../../domain/events/StreamId.ts";
import { StreamVersion } from "../../../domain/events/StreamVersion.ts";
import { Timestamp } from "../../../domain/events/Timestamp.ts";
import { TypeVersion } from "../../../domain/events/TypeVersion.ts";
import { CanonicalJson } from "../../../domain/shared/CanonicalJson.ts";
import type { SqliteDatabase } from "./SqliteDatabase.ts";

type Row = Record<string, unknown>;

export class SqliteEventStore implements EventStore {
  readonly #db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.#db = db; }

  append(stream: StreamId, expected: StreamVersion, facts: Fact[], recordedAt: Timestamp): AppendOutcome {
    return this.#db.transaction(() => {
      const plan = AppendPlanner.plan(this.head(stream), (id) => this.find(stream, id), expected, facts, recordedAt);
      this.#insert(plan.toWrite);
      return plan.outcome;
    });
  }

  importSealed(records: EventRecord[]): number {
    return this.#db.transaction(() => {
      const toWrite = ImportPlanner.plan((s) => this.readStream(s), records);
      this.#insert(toWrite);
      return toWrite.length;
    });
  }

  head(stream: StreamId): StreamHead | null {
    const row = this.#db.handle.prepare("SELECT version, head_hash, last_event_id, correlation_id FROM streams WHERE stream = ?").get(stream.value) as Row | undefined;
    return row === undefined ? null : StreamHead.of({ stream, version: StreamVersion.of(Number(row.version)), hash: EventHash.of(String(row.head_hash)),
      lastEventId: EventId.of(String(row.last_event_id)), correlationId: EventId.of(String(row.correlation_id)) });
  }

  find(stream: StreamId, id: EventId): EventRecord | null {
    const row = this.#db.handle.prepare("SELECT * FROM events WHERE stream = ? AND event_id = ?").get(stream.value, id.value) as Row | undefined;
    return row === undefined ? null : this.#toRecord(row);
  }

  readStream(stream: StreamId): EventRecord[] {
    return (this.#db.handle.prepare("SELECT * FROM events WHERE stream = ? ORDER BY version").all(stream.value) as Row[]).map((r) => this.#toRecord(r));
  }

  readAll(after: GlobalPosition, limit: number): StoredEvent[] {
    return (this.#db.handle.prepare("SELECT * FROM events WHERE global_position > ? ORDER BY global_position LIMIT ?").all(after.value, limit) as Row[])
      .map((r) => StoredEvent.of(GlobalPosition.of(Number(r.global_position)), this.#toRecord(r)));
  }

  streams(): StreamId[] { return (this.#db.handle.prepare("SELECT stream FROM streams ORDER BY stream").all() as Row[]).map((r) => StreamId.of(String(r.stream))); }

  lastPosition(): GlobalPosition { return GlobalPosition.of(Number((this.#db.handle.prepare("SELECT COALESCE(MAX(global_position), 0) AS p FROM events").get() as Row).p)); }

  #insert(records: EventRecord[]): void {
    const ins = this.#db.handle.prepare(`INSERT INTO events (stream, version, event_id, type, type_version, occurred_at, recorded_at, actor_kind, actor_id,
      correlation_id, causation_id, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const head = this.#db.handle.prepare(`INSERT INTO streams (stream, version, head_hash, last_event_id, correlation_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(stream) DO UPDATE SET version = excluded.version, head_hash = excluded.head_hash, last_event_id = excluded.last_event_id`);
    for (const r of records) {
      ins.run(r.stream.value, r.version.value, r.id.value, r.type.value, r.typeVersion.value, r.occurredAt.value, r.recordedAt.value, r.actor.kind, r.actor.id,
        r.correlationId.value, r.causationId?.value ?? null, r.payload.text, r.prevHash?.value ?? null, r.hash.value);
      head.run(r.stream.value, r.version.value, r.hash.value, r.id.value, r.correlationId.value);
    }
  }

  #toRecord(r: Row): EventRecord {
    return EventRecord.restore({
      id: EventId.of(String(r.event_id)), stream: StreamId.of(String(r.stream)), version: StreamVersion.of(Number(r.version)), type: EventType.of(String(r.type)),
      typeVersion: TypeVersion.of(Number(r.type_version)), occurredAt: Timestamp.parse(String(r.occurred_at)), recordedAt: Timestamp.parse(String(r.recorded_at)),
      actor: Actor.of(String(r.actor_kind), String(r.actor_id)), correlationId: EventId.of(String(r.correlation_id)),
      causationId: r.causation_id === null ? null : EventId.of(String(r.causation_id)), payload: CanonicalJson.parse(String(r.payload)),
      prevHash: r.prev_hash === null ? null : EventHash.of(String(r.prev_hash)), hash: EventHash.of(String(r.hash)),
    });
  }
}
