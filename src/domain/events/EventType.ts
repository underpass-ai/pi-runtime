import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SESSION = ["session.opened", "session.closed", "phase.changed", "turn.completed", "tool.started", "tool.completed", "model.selected", "context.compacted"];
const HOST = ["host.started", "host.stopped", "server.started", "server.exited"];

export class EventType extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): EventType {
    if (typeof raw !== "string" || (!SESSION.includes(raw) && !HOST.includes(raw))) throw DomainError.because(`unknown event type "${raw}"`);
    return new EventType(raw);
  }
  belongsToSessions(): boolean { return SESSION.includes(this.value); }
}
