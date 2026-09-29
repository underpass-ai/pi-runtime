import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class Phase extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly INTERACTIVE = new Phase("interactive");
  static readonly DESIGN = new Phase("design");
  static of(raw: string): Phase {
    if (raw === "interactive") return Phase.INTERACTIVE;
    if (raw === "design") return Phase.DESIGN;
    throw DomainError.because(`unknown phase ${raw}`);
  }
}
