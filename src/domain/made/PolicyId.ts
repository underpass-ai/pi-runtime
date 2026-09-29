import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class PolicyId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): PolicyId {
    if (typeof raw !== "string" || !raw || /[\s=]/.test(raw)) throw DomainError.because("policy id must be non-empty without whitespace or '='");
    return new PolicyId(raw);
  }
}
