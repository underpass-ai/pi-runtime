import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ProjectionName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ProjectionName {
    if (typeof raw !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(raw)) throw DomainError.because(`invalid projection name "${raw}"`);
    return new ProjectionName(raw);
  }
}
