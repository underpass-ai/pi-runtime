import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// k: cuántas candidatas se exponen además del mínimo fijo (spec §1). Entre 4 y 64; 12 por defecto.
export class SelectionSize extends ValueObject<number> {
  private constructor(v: number) { super(v); }
  static readonly MIN = 4;
  static readonly MAX = 64;
  static readonly DEFAULT = new SelectionSize(12);

  static of(n: number): SelectionSize {
    if (typeof n !== "number" || !Number.isInteger(n) || n < SelectionSize.MIN || n > SelectionSize.MAX) {
      throw DomainError.because(`k must be an integer between ${SelectionSize.MIN} and ${SelectionSize.MAX}`);
    }
    return new SelectionSize(n);
  }
}
