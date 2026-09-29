import type { EventRecord } from "./EventRecord.ts";

export class Appended {
  readonly records: readonly EventRecord[]; readonly idempotent: boolean;
  private constructor(records: EventRecord[], idempotent: boolean) { this.records = records; this.idempotent = idempotent; }
  static fresh(records: EventRecord[]): Appended { return new Appended(records, false); }
  static idempotentOf(records: EventRecord[]): Appended { return new Appended(records, true); }
}
