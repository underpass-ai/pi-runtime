import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import { SessionId } from "./SessionId.ts";

const PREFIX = "session:";

export class StreamId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly HOST = new StreamId("host");
  static of(raw: string): StreamId {
    if (raw === "host") return StreamId.HOST;
    if (typeof raw === "string" && raw.startsWith(PREFIX)) return StreamId.session(SessionId.of(raw.slice(PREFIX.length)));
    throw DomainError.because(`invalid stream "${raw}"`);
  }
  static session(id: SessionId): StreamId { return new StreamId(`${PREFIX}${id.value}`); }
  isSession(): boolean { return this.value.startsWith(PREFIX); }
  sessionId(): SessionId {
    if (!this.isSession()) throw DomainError.because(`stream ${this.value} is not a session stream`);
    return SessionId.of(this.value.slice(PREFIX.length));
  }
}
