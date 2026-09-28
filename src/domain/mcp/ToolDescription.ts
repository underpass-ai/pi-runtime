import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ToolDescription extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ToolDescription {
    if (!raw.trim()) throw DomainError.because("tool description must not be empty");
    return new ToolDescription(raw);
  }
}
