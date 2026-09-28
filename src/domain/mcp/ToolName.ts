import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ToolName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ToolName {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(raw)) throw DomainError.because(`invalid tool name ${raw}`);
    return new ToolName(raw);
  }
  hasPrefix(prefix: string): boolean { return this.value.startsWith(prefix); }
}
