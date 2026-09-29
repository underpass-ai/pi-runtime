import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CheckSection extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly PI = new CheckSection("pi");
  static readonly KMP = new CheckSection("kmp");
  static readonly MADE = new CheckSection("made");
  static readonly HOST = new CheckSection("host");
  static of(raw: string): CheckSection {
    if (typeof raw !== "string") throw DomainError.because(`unknown check section ${raw}`);
    const found = [CheckSection.PI, CheckSection.KMP, CheckSection.MADE, CheckSection.HOST].find((s) => s.value === raw);
    if (!found) throw DomainError.because(`unknown check section ${raw}`);
    return found;
  }
}
