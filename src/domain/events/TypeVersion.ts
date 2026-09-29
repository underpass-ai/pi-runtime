import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class TypeVersion extends ValueObject<number> {
  private constructor(v: number) { super(v); }
  static readonly V1 = new TypeVersion(1);
  static of(n: number): TypeVersion {
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw DomainError.because(`invalid type version ${n}`);
    return new TypeVersion(n);
  }
}
