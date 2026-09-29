import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { EventId } from "../events/EventId.ts";
import { TelemetryDigest } from "./TelemetryDigest.ts";

// 8 bytes en hex, derivados del event_id del hecho que abre el span: reexportar da los mismos ids.
export class SpanId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): SpanId {
    if (typeof raw !== "string" || !/^[0-9a-f]{16}$/.test(raw) || /^0+$/.test(raw)) throw DomainError.because("span id must be 16 lowercase hex characters, not all zero");
    return new SpanId(raw);
  }
  static forEvent(id: EventId): SpanId { return SpanId.of(TelemetryDigest.hex("pi-runtime.span", id.value).slice(0, 16)); }
}
