import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CheckName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CheckName {
    if (typeof raw !== "string" || !raw.trim()) throw DomainError.because("check name must not be empty");
    return new CheckName(raw);
  }
}
