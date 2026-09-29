import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Token de confirmación (S3a §3): lo genera el host con 16 bytes de entropía y la extensión sólo lo reenvía.
export class ConfirmationToken extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ConfirmationToken {
    if (typeof raw !== "string" || !/^[0-9a-f]{32}$/.test(raw)) throw DomainError.because("invalid confirmation token");
    return new ConfirmationToken(raw);
  }
  static fromEntropy(bytes: Uint8Array): ConfirmationToken {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw DomainError.because("a confirmation token needs exactly 16 bytes of entropy");
    return new ConfirmationToken([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
  }
}
