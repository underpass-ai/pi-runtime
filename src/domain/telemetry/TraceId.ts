import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { EventId } from "../events/EventId.ts";
import { StreamId } from "../events/StreamId.ts";
import { TelemetryDigest } from "./TelemetryDigest.ts";

// 16 bytes en hex. Una sesión es una traza (su stream); el host, una traza por arranque.
export class TraceId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): TraceId {
    if (typeof raw !== "string" || !/^[0-9a-f]{32}$/.test(raw) || /^0+$/.test(raw)) throw DomainError.because("trace id must be 32 lowercase hex characters, not all zero");
    return new TraceId(raw);
  }
  static forStream(stream: StreamId): TraceId { return TraceId.of(TelemetryDigest.hex("pi-runtime.trace", stream.value).slice(0, 32)); }
  static forHostRun(started: EventId): TraceId { return TraceId.of(TelemetryDigest.hex("pi-runtime.trace", StreamId.HOST.value, started.value).slice(0, 32)); }
}
