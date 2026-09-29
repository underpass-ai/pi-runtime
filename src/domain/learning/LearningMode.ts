import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Modo de L1 (spec §4). off, shadow y active se eligen con `underpass learning mode`;
// fallback sólo lo registra una decisión que el host no pudo tomar.
export class LearningMode extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly OFF = new LearningMode("off");
  static readonly SHADOW = new LearningMode("shadow");
  static readonly ACTIVE = new LearningMode("active");
  static readonly FALLBACK = new LearningMode("fallback");
  static readonly DEFAULT = LearningMode.SHADOW;

  static of(raw: string): LearningMode {
    const found = [LearningMode.OFF, LearningMode.SHADOW, LearningMode.ACTIVE, LearningMode.FALLBACK].find((m) => m.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown learning mode ${raw}`);
    return found;
  }

  static setting(raw: string): LearningMode {
    const mode = LearningMode.of(raw);
    if (mode.equals(LearningMode.FALLBACK)) throw DomainError.because("fallback is not a learning mode that can be set");
    return mode;
  }
}
