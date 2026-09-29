import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class SessionId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): SessionId {
    if (typeof raw !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(raw)) throw DomainError.because(`invalid session id "${raw}"`);
    return new SessionId(raw);
  }
}
