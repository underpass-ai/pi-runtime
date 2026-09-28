import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class RefusalCode extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly UNKNOWN = new RefusalCode("unknown");
  static of(raw: string): RefusalCode {
    if (!/^[a-z][a-z0-9_]*$/.test(raw)) throw DomainError.because(`invalid refusal code "${raw}"`);
    return new RefusalCode(raw);
  }
}
