import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CapabilityGroupId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CapabilityGroupId {
    if (!/^[a-z][a-z0-9_.-]*$/.test(raw)) throw DomainError.because(`invalid capability group ${raw}`);
    return new CapabilityGroupId(raw);
  }
}
