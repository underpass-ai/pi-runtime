import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CheckDetail extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CheckDetail {
    if (typeof raw !== "string") throw DomainError.because(`check detail must be a string: ${raw}`);
    return new CheckDetail(raw.replace(/\s+/g, " ").trim());
  }
}
