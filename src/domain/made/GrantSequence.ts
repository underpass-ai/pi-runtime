import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Cuántos grants con la misma sesión, acción y alcance registró ya el host en el log. Entra en el
// id del grant para que reemitir tras una revocación en el mismo milisegundo no repita el id (MADE
// trataría como no-op un grant idéntico ya revocado). Determinista: sale del log.
export class GrantSequence extends ValueObject<number> {
  private constructor(v: number) { super(v); }
  static readonly FIRST = new GrantSequence(0);
  static of(raw: number): GrantSequence {
    if (!Number.isSafeInteger(raw) || raw < 0) throw DomainError.because(`invalid grant sequence ${raw}`);
    return raw === 0 ? GrantSequence.FIRST : new GrantSequence(raw);
  }
}
