import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class GlobalPosition extends ValueObject<number> {
  private constructor(v: number) { super(v); }
  static readonly START = new GlobalPosition(0);
  static of(n: number): GlobalPosition {
    if (!Number.isInteger(n) || n < 0) throw DomainError.because(`invalid global position ${n}`);
    return new GlobalPosition(n);
  }
}
