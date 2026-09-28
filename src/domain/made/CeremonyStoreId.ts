import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CeremonyStoreId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CeremonyStoreId {
    if (typeof raw !== "string" || !raw || /[\s=]/.test(raw)) throw DomainError.because("ceremony store id must be non-empty without whitespace or '='");
    return new CeremonyStoreId(raw);
  }
}
