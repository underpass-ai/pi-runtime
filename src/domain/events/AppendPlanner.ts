import { AppendConflict } from "./AppendConflict.ts";
import type { AppendOutcome } from "./AppendOutcome.ts";
import { Appended } from "./Appended.ts";
import { ContinuationSealer } from "./ContinuationSealer.ts";
import type { EventId } from "./EventId.ts";
import type { EventRecord } from "./EventRecord.ts";
import type { Fact } from "./Fact.ts";
import type { StreamHead } from "./StreamHead.ts";
import { StreamVersion } from "./StreamVersion.ts";
import type { Timestamp } from "./Timestamp.ts";

export class AppendPlanner {
  private constructor() {}
  // Los duplicados se resuelven ANTES que la versión: un reintento tras un
  // éxito perdido llega con una versión esperada obsoleta y debe ser idempotente.
  static plan(head: StreamHead | null, find: (id: EventId) => EventRecord | null, expected: StreamVersion, facts: Fact[], recordedAt: Timestamp): { outcome: AppendOutcome; toWrite: EventRecord[] } {
    const actual = head?.version ?? StreamVersion.NONE;
    const existing: EventRecord[] = []; const fresh: Fact[] = [];
    for (const f of facts) {
      const found = find(f.id);
      if (found === null) { fresh.push(f); continue; }
      if (!found.matches(f)) return { outcome: AppendConflict.diverged(expected, actual, f.id), toWrite: [] };
      existing.push(found);
    }
    if (fresh.length === 0) return { outcome: Appended.idempotentOf(existing), toWrite: [] };
    if (!expected.equals(actual)) return { outcome: AppendConflict.version(expected, actual), toWrite: [] };
    const sealed = ContinuationSealer.seal(head, fresh, recordedAt);
    return { outcome: Appended.fresh([...existing, ...sealed]), toWrite: sealed };
  }
}
