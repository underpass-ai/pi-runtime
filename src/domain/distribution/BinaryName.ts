import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class BinaryName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP = new BinaryName("kmp-mcp");
  static readonly MADE = new BinaryName("made-mcp");
  static of(raw: string): BinaryName {
    if (raw === BinaryName.KMP.value) return BinaryName.KMP;
    if (raw === BinaryName.MADE.value) return BinaryName.MADE;
    throw DomainError.because(`unknown binary ${raw}`);
  }
}
