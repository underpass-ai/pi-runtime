import { EventHasher } from "./EventHasher.ts";
import type { EventRecord } from "./EventRecord.ts";
import { VerificationResult } from "./VerificationResult.ts";

export class StreamVerifier {
  private constructor() {}
  static verify(records: EventRecord[]): VerificationResult {
    if (records.length === 0) return VerificationResult.notFound();
    const stream = records[0].stream;
    let prev: EventRecord | null = null;
    for (const r of records) {
      const expected = prev === null ? 1 : prev.version.value + 1;
      if (!r.stream.equals(stream)) return VerificationResult.broken(r.version, "mixed streams");
      if (r.version.value !== expected) return VerificationResult.broken(r.version, `expected version ${expected}`);
      const linked = prev === null ? r.prevHash === null : r.prevHash !== null && r.prevHash.equals(prev.hash);
      if (!linked) return VerificationResult.broken(r.version, "broken link");
      if (!r.correlationId.equals(prev === null ? r.id : prev.correlationId)) return VerificationResult.broken(r.version, "correlation mismatch");
      const causationOk = prev === null ? r.causationId === null : r.causationId !== null && r.causationId.equals(prev.id);
      if (!causationOk) return VerificationResult.broken(r.version, "causation mismatch");
      if (!EventHasher.compute(r).equals(r.hash)) return VerificationResult.broken(r.version, "digest mismatch");
      prev = r;
    }
    return VerificationResult.intact(prev!.version);
  }
}
