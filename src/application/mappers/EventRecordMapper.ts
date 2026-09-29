import { Actor } from "../../domain/events/Actor.ts";
import { EventHash } from "../../domain/events/EventHash.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventRecord } from "../../domain/events/EventRecord.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { StreamVersion } from "../../domain/events/StreamVersion.ts";
import { Timestamp } from "../../domain/events/Timestamp.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import type { EventRecordDto } from "../dto/EventRecordDto.ts";

export class EventRecordMapper {
  toDto(r: EventRecord): EventRecordDto {
    return { eventId: r.id.value, stream: r.stream.value, version: r.version.value, type: r.type.value, typeVersion: r.typeVersion.value, occurredAt: r.occurredAt.value,
      recordedAt: r.recordedAt.value, actor: { kind: r.actor.kind, id: r.actor.id }, correlationId: r.correlationId.value, causationId: r.causationId?.value ?? null,
      payload: r.payload.toValue(), prevHash: r.prevHash?.value ?? null, hash: r.hash.value };
  }
  toDomain(d: EventRecordDto): EventRecord {
    return EventRecord.restore({ id: EventId.of(d.eventId), stream: StreamId.of(d.stream), version: StreamVersion.of(d.version), type: EventType.of(d.type),
      typeVersion: TypeVersion.of(d.typeVersion), occurredAt: Timestamp.parse(d.occurredAt), recordedAt: Timestamp.parse(d.recordedAt), actor: Actor.of(d.actor?.kind, d.actor?.id),
      correlationId: EventId.of(d.correlationId), causationId: d.causationId === null ? null : EventId.of(d.causationId), payload: CanonicalJson.of(d.payload),
      prevHash: d.prevHash === null ? null : EventHash.of(d.prevHash), hash: EventHash.of(d.hash) });
  }
}
