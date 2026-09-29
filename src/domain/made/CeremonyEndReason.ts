import { ValueObject } from "../shared/ValueObject.ts";

// Cómo terminó una instancia según MADE (`end_reason`: completed, cancelled, failed…). Lo que no
// tenga forma de identificador se guarda como `unknown`: nunca texto libre en el log.
export class CeremonyEndReason extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly UNKNOWN = new CeremonyEndReason("unknown");
  static of(raw: unknown): CeremonyEndReason {
    return typeof raw === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(raw) ? new CeremonyEndReason(raw) : CeremonyEndReason.UNKNOWN;
  }
}
