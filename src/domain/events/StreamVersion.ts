import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class StreamVersion extends ValueObject<number> {
  private constructor(v: number) { super(v); }
  static readonly NONE = new StreamVersion(0);
  static of(n: number): StreamVersion {
    if (!Number.isInteger(n) || n < 0) throw DomainError.because(`invalid stream version ${n}`);
    return new StreamVersion(n);
  }
  next(): StreamVersion { return new StreamVersion(this.value + 1); }
}
