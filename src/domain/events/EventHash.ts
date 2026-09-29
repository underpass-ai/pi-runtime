import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class EventHash extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): EventHash {
    if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("event hash must be 64 lowercase hex characters");
    return new EventHash(raw);
  }
}
