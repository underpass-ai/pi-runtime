import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class DeclaredLimitId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly ROSTER_PROCESS_LOCAL = new DeclaredLimitId("agent_roster_is_process_local");
  static of(raw: string): DeclaredLimitId {
    if (!/^[a-z][a-z0-9_]*$/.test(raw)) throw DomainError.because(`invalid declared limit ${raw}`);
    return new DeclaredLimitId(raw);
  }
}
