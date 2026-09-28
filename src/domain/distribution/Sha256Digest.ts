import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class Sha256Digest extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): Sha256Digest {
    const v = raw.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(v)) throw DomainError.because("sha256 digest must be 64 hex characters");
    return new Sha256Digest(v);
  }
}
