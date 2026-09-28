import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class SemVer extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): SemVer {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(raw)) throw DomainError.because(`invalid semver ${raw}`);
    return new SemVer(raw);
  }
}
