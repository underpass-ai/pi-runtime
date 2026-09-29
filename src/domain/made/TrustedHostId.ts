import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class TrustedHostId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): TrustedHostId {
    if (typeof raw !== "string" || !raw || /[\s=]/.test(raw)) throw DomainError.because("trusted host id must be non-empty without whitespace or '='");
    return new TrustedHostId(raw);
  }
}
