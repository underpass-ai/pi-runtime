import type { EventHash } from "./EventHash.ts";
import type { EventId } from "./EventId.ts";
import type { StreamId } from "./StreamId.ts";
import type { StreamVersion } from "./StreamVersion.ts";

type Props = { stream: StreamId; version: StreamVersion; hash: EventHash; lastEventId: EventId; correlationId: EventId };

export class StreamHead {
  readonly stream: StreamId; readonly version: StreamVersion; readonly hash: EventHash; readonly lastEventId: EventId; readonly correlationId: EventId;
  private constructor(p: Props) { this.stream = p.stream; this.version = p.version; this.hash = p.hash; this.lastEventId = p.lastEventId; this.correlationId = p.correlationId; }
  static of(p: Props): StreamHead { return new StreamHead(p); }
}
