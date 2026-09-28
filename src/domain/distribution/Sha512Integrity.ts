import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class Sha512Integrity extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): Sha512Integrity {
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(raw)) throw DomainError.because("integrity must be an SRI sha512 string");
    return new Sha512Integrity(raw);
  }
}
