import { DomainError } from "../shared/DomainError.ts";
import type { EventRecord } from "./EventRecord.ts";
import type { StreamId } from "./StreamId.ts";
import { StreamVerifier } from "./StreamVerifier.ts";

export class ImportPlanner {
  private constructor() {}
  static plan(existingOf: (s: StreamId) => EventRecord[], incoming: EventRecord[]): EventRecord[] {
    const byStream = new Map<string, EventRecord[]>();
    for (const r of incoming) byStream.set(r.stream.value, [...(byStream.get(r.stream.value) ?? []), r]);
    const toWrite: EventRecord[] = [];
    for (const records of byStream.values()) {
      const existing = existingOf(records[0].stream);
      for (const r of records) {
        const mine = existing[r.version.value - 1];
        if (mine !== undefined && !mine.hash.equals(r.hash)) throw DomainError.because(`stream ${r.stream.value} diverges at version ${r.version.value}`);
      }
      const tail = records.filter((r) => r.version.value > existing.length);
      if (tail.length === 0) continue;
      if (tail[0].version.value !== existing.length + 1) throw DomainError.because(`gap in ${tail[0].stream.value}: expected version ${existing.length + 1}`);
      const check = StreamVerifier.verify([...existing, ...tail]);
      if (!check.isIntact()) throw DomainError.because(`broken chain in ${tail[0].stream.value} at version ${check.version?.value}: ${check.reason}`);
      toWrite.push(...tail);
    }
    return toWrite;
  }
}
