import type { EventId } from "./EventId.ts";
import type { StreamVersion } from "./StreamVersion.ts";

export class AppendConflict {
  readonly expected: StreamVersion; readonly actual: StreamVersion; readonly reason: "version" | "diverged"; readonly eventId: EventId | null;
  private constructor(expected: StreamVersion, actual: StreamVersion, reason: "version" | "diverged", eventId: EventId | null) { this.expected = expected; this.actual = actual; this.reason = reason; this.eventId = eventId; }
  static version(expected: StreamVersion, actual: StreamVersion): AppendConflict { return new AppendConflict(expected, actual, "version", null); }
  static diverged(expected: StreamVersion, actual: StreamVersion, id: EventId): AppendConflict { return new AppendConflict(expected, actual, "diverged", id); }
}
