import type { EventRecord } from "./EventRecord.ts";
import type { GlobalPosition } from "./GlobalPosition.ts";

export class StoredEvent {
  readonly position: GlobalPosition; readonly record: EventRecord;
  private constructor(position: GlobalPosition, record: EventRecord) { this.position = position; this.record = record; }
  static of(position: GlobalPosition, record: EventRecord): StoredEvent { return new StoredEvent(position, record); }
}
