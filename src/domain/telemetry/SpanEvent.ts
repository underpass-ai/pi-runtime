import { DomainError } from "../shared/DomainError.ts";
import type { Timestamp } from "../events/Timestamp.ts";
import type { SpanAttributes } from "./SpanAttributes.ts";

const NAMES = ["phase.changed", "model.selected", "context.compacted", "tools.selected"];

// Evento dentro del span de sesión (spec §4).
export class SpanEvent {
  readonly name: string; readonly at: Timestamp; readonly attributes: SpanAttributes;
  private constructor(name: string, at: Timestamp, attributes: SpanAttributes) { this.name = name; this.at = at; this.attributes = attributes; }
  static of(name: string, at: Timestamp, attributes: SpanAttributes): SpanEvent {
    if (!NAMES.includes(name)) throw DomainError.because(`unknown span event ${name}`);
    return new SpanEvent(name, at, attributes);
  }
}
