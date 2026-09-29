import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Qué pasó con una confirmación pedida (S3a §4, hecho made.confirmation).
export class ConfirmationOutcome extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly ACCEPTED = new ConfirmationOutcome("accepted");
  static readonly DECLINED = new ConfirmationOutcome("declined");
  static readonly NO_UI = new ConfirmationOutcome("no_ui");
  static of(raw: string): ConfirmationOutcome {
    const found = [ConfirmationOutcome.ACCEPTED, ConfirmationOutcome.DECLINED, ConfirmationOutcome.NO_UI].find((o) => o.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown confirmation outcome ${raw}`);
    return found;
  }
  // Lo que la extensión puede comunicar por sí misma: aceptar sólo se prueba reenviando el token.
  static refusal(raw: string): ConfirmationOutcome {
    const o = ConfirmationOutcome.of(raw);
    if (o.equals(ConfirmationOutcome.ACCEPTED)) throw DomainError.because("an accepted confirmation is proved by resending the call with its token");
    return o;
  }
}
