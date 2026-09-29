import { Actor } from "../../domain/events/Actor.ts";
import { EventAbout } from "../../domain/events/EventAbout.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { Fact } from "../../domain/events/Fact.ts";
import { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { Timestamp } from "../../domain/events/Timestamp.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import { DomainError } from "../../domain/shared/DomainError.ts";
import type { FactDto } from "../dto/FactDto.ts";

// §1.3: sólo se aceptan los pares (tipo, type_version) conocidos. En v1, los
// tipos de §1.2 y sólo type_version 1 (los upcasters llegarán con una v2).
const V1_TYPES = new Set(["session.opened", "session.closed", "phase.changed", "turn.completed", "tool.started", "tool.completed",
  "model.selected", "context.compacted", "host.started", "host.stopped", "server.started", "server.exited"]);

export class FactMapper {
  toDomain(dto: FactDto): Fact {
    if (typeof dto !== "object" || dto === null) throw DomainError.because("fact must be an object");
    const stream = this.#stream(dto);
    const type = EventType.of(dto.type);
    const typeVersion = TypeVersion.of(dto.typeVersion);
    if (!V1_TYPES.has(type.value) || !typeVersion.equals(TypeVersion.V1)) throw DomainError.because(`unknown event type ${type.value} v${typeVersion.value}`);
    const payload = dto.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw DomainError.because("fact payload must be an object");
    return Fact.of({
      id: EventId.derive(stream, type, EventAbout.of(dto.about)), stream, type, typeVersion,
      occurredAt: Timestamp.fromEpochMs(dto.occurredAtMs), actor: Actor.of(dto.actor?.kind, dto.actor?.id), payload: CanonicalJson.of(payload),
    });
  }

  #stream(dto: FactDto): StreamId {
    if (dto.stream === "host") return StreamId.HOST;
    if (dto.stream === "session") return StreamId.session(SessionId.of(dto.sessionId as string));
    throw DomainError.because(`unknown stream kind "${String(dto.stream)}"`);
  }
}
