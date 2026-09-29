import { DomainError } from "../shared/DomainError.ts";
import { EventHasher } from "./EventHasher.ts";
import type { EventHash } from "./EventHash.ts";
import type { EventId } from "./EventId.ts";
import { EventRecord } from "./EventRecord.ts";
import type { Fact } from "./Fact.ts";
import type { StreamHead } from "./StreamHead.ts";
import { StreamVersion } from "./StreamVersion.ts";
import type { Timestamp } from "./Timestamp.ts";

export class ContinuationSealer {
  private constructor() {}
  static seal(head: StreamHead | null, facts: Fact[], recordedAt: Timestamp): EventRecord[] {
    if (facts.length === 0) throw DomainError.because("cannot seal an empty batch");
    const stream = facts[0].stream;
    if (head !== null && !head.stream.equals(stream)) throw DomainError.because("the head belongs to another stream");
    const seen = new Set<string>();
    let version = head?.version ?? StreamVersion.NONE;
    let prevHash: EventHash | null = head?.hash ?? null;
    let causation: EventId | null = head?.lastEventId ?? null;
    const correlation = head?.correlationId ?? facts[0].id;
    const out: EventRecord[] = [];
    for (const f of facts) {
      if (!f.stream.equals(stream)) throw DomainError.because("a batch must target one stream");
      if (seen.has(f.id.value)) throw DomainError.because(`duplicate event id ${f.id.value} in batch`);
      seen.add(f.id.value);
      version = version.next();
      const base = { id: f.id, stream, version, type: f.type, typeVersion: f.typeVersion, occurredAt: f.occurredAt, recordedAt, actor: f.actor,
        correlationId: correlation, causationId: causation, payload: f.payload, prevHash };
      const record = EventRecord.restore({ ...base, hash: EventHasher.compute(base) });
      out.push(record);
      prevHash = record.hash; causation = f.id;
    }
    return out;
  }
}
