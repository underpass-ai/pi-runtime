import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class EventAbout extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): EventAbout {
    if (typeof raw !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(raw)) throw DomainError.because(`invalid event about "${raw}"`);
    return new EventAbout(raw);
  }
}
