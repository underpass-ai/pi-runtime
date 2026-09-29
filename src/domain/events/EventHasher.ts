import { createHash } from "node:crypto";
import type { CanonicalJson } from "../shared/CanonicalJson.ts";
import type { Actor } from "./Actor.ts";
import { EventHash } from "./EventHash.ts";
import type { EventId } from "./EventId.ts";
import type { EventType } from "./EventType.ts";
import type { StreamId } from "./StreamId.ts";
import type { StreamVersion } from "./StreamVersion.ts";
import type { Timestamp } from "./Timestamp.ts";
import type { TypeVersion } from "./TypeVersion.ts";

type Hashable = {
  id: EventId; stream: StreamId; version: StreamVersion; type: EventType; typeVersion: TypeVersion; occurredAt: Timestamp; recordedAt: Timestamp;
  actor: Actor; correlationId: EventId; causationId: EventId | null; payload: CanonicalJson; prevHash: { value: string } | null;
};

const DOMAIN = "pi-runtime.event.v1";
const encoder = new TextEncoder();

export class EventHasher {
  private constructor() {}
  static compute(p: Hashable): EventHash {
    const fields = [p.id.value, p.stream.value, String(p.version.value), p.type.value, String(p.typeVersion.value), p.occurredAt.value, p.recordedAt.value,
      p.actor.kind, p.actor.id, p.correlationId.value, p.causationId?.value ?? "", p.payload.text, p.prevHash?.value ?? ""];
    const h = createHash("sha256").update(DOMAIN);
    for (const f of fields) { const bytes = encoder.encode(f); h.update(`${bytes.length}:`); h.update(bytes); }
    return EventHash.of(h.digest("hex"));
  }
}
