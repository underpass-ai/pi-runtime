import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Por qué el host revoca un grant (S3a §4).
export class RevocationReason extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly SESSION_CLOSED = new RevocationReason("session_closed");
  static readonly EXPIRED_CLEANUP = new RevocationReason("expired_cleanup");
  // El grant de 5 min de una confirmación, en cuanto su llamada vuelve (ruling R5): un solo uso.
  static readonly CONSUMED = new RevocationReason("consumed");
  static of(raw: string): RevocationReason {
    const found = [RevocationReason.SESSION_CLOSED, RevocationReason.EXPIRED_CLEANUP, RevocationReason.CONSUMED].find((r) => r.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown revocation reason ${raw}`);
    return found;
  }
}
