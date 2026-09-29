import { DomainError } from "../shared/DomainError.ts";
import { Timestamp } from "../events/Timestamp.ts";
import { SpanAttributes } from "./SpanAttributes.ts";
import { SpanEvent } from "./SpanEvent.ts";
import { SpanId } from "./SpanId.ts";
import type { SpanJson } from "./SpanJson.ts";
import { SpanStatus } from "./SpanStatus.ts";
import { TraceId } from "./TraceId.ts";

const NAMES = ["session", "turn", "tool", "host", "mcp_server"];
type Props = {
  traceId: TraceId; spanId: SpanId; parentId: SpanId | null; name: string; start: Timestamp; end: Timestamp;
  status: SpanStatus; attributes: SpanAttributes; events: SpanEvent[];
};

// Un span cerrado. Un fin anterior al inicio (relojes desalineados) se ajusta al inicio.
export class Span {
  readonly traceId: TraceId; readonly spanId: SpanId; readonly parentId: SpanId | null; readonly name: string;
  readonly start: Timestamp; readonly end: Timestamp; readonly status: SpanStatus; readonly attributes: SpanAttributes; readonly events: readonly SpanEvent[];
  private constructor(p: Props) {
    this.traceId = p.traceId; this.spanId = p.spanId; this.parentId = p.parentId; this.name = p.name;
    this.start = p.start; this.end = p.end; this.status = p.status; this.attributes = p.attributes; this.events = p.events;
  }

  static of(p: Props): Span {
    if (!NAMES.includes(p.name)) throw DomainError.because(`unknown span name ${p.name}`);
    return new Span({ ...p, end: p.end.epochMs() < p.start.epochMs() ? p.start : p.end, events: [...p.events] });
  }

  durationMs(): number { return this.end.epochMs() - this.start.epochMs(); }

  toJson(): SpanJson {
    return {
      traceId: this.traceId.value, spanId: this.spanId.value, parentId: this.parentId?.value ?? null, name: this.name,
      startMs: this.start.epochMs(), endMs: this.end.epochMs(), status: this.status.value, attributes: this.attributes.toRecord(),
      events: this.events.map((e) => ({ name: e.name, atMs: e.at.epochMs(), attributes: e.attributes.toRecord() })),
    };
  }

  static fromJson(j: SpanJson): Span {
    return Span.of({
      traceId: TraceId.of(j.traceId), spanId: SpanId.of(j.spanId), parentId: j.parentId === null ? null : SpanId.of(j.parentId), name: j.name,
      start: Timestamp.fromEpochMs(j.startMs), end: Timestamp.fromEpochMs(j.endMs), status: SpanStatus.of(j.status), attributes: SpanAttributes.of(j.attributes),
      events: j.events.map((e) => SpanEvent.of(e.name, Timestamp.fromEpochMs(e.atMs), SpanAttributes.of(e.attributes))),
    });
  }
}
