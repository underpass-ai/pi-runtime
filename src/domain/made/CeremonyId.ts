import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Id de una instancia de ceremonia de MADE (el `ceremony_id` de un alcance `ceremony`): lo elige
// quien la arranca. Sólo identidad: acotado y sin caracteres de control.
export class CeremonyId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CeremonyId {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 256 || /[\u0000-\u001f\u007f]/.test(raw)) throw DomainError.because("invalid MADE ceremony id");
    return new CeremonyId(raw);
  }
  // Huella corta y estable para ids de hechos: el texto del id nunca va en el id de un hecho.
  fingerprint(): string { return createHash("sha256").update(this.value).digest("hex").slice(0, 32); }
  // El id si el valor es uno válido; null si no (argumentos del modelo, payloads de MADE).
  static maybe(raw: unknown): CeremonyId | null {
    try { return CeremonyId.of(raw as string); } catch { return null; }
  }
}
