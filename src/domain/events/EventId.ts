import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { EventAbout } from "./EventAbout.ts";
import type { EventType } from "./EventType.ts";
import type { StreamId } from "./StreamId.ts";

export class EventId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): EventId {
    if (typeof raw !== "string" || !/^\S{1,500}$/.test(raw)) throw DomainError.because(`invalid event id "${raw}"`);
    return new EventId(raw);
  }
  static derive(stream: StreamId, type: EventType, about: EventAbout): EventId { return new EventId(`${stream.value}:${type.value}:${about.value}`); }
}
