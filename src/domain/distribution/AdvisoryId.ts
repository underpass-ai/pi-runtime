import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class AdvisoryId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): AdvisoryId {
    if (typeof raw !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(raw.trim())) throw DomainError.because(`invalid advisory id "${raw}"`);
    return new AdvisoryId(raw.trim());
  }
}
