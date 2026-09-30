import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import { ToolRefusal } from "../mcp/ToolRefusal.ts";

const DENIAL = /^authorization decision ([0-9a-f]{64}) denied the operation$/;
// El código con el que MADE 0.8.0 y 0.9.0 niegan por autorización (ToolError::refused en made-mcp).
const REFUSED = "refused";

// Id de una decisión de autorización de MADE (sha256 en hex).
export class MadeDecisionId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): MadeDecisionId {
    if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("MADE decision id must be a lowercase sha256");
    return new MadeDecisionId(raw);
  }

  // La denegación de MADE 0.8.0 y 0.9.0 en modo embebido: negativa con el código `refused` y este mensaje
  // exacto. El texto solo, con otro código, no es una denegación: pasa tal cual.
  static fromDenial(refusal: ToolRefusal): MadeDecisionId | null {
    if (!(refusal instanceof ToolRefusal) || refusal.code.value !== REFUSED) return null;
    const m = DENIAL.exec(refusal.message);
    return m === null ? null : new MadeDecisionId(m[1]);
  }

  // Cursor exclusivo que deja esta decisión la primera de la página: MADE ordena por id y
  // devuelve las de id mayor que el cursor. null para el id más pequeño (sin cursor).
  cursor(): string | null {
    const n = BigInt(`0x${this.value}`);
    return n === 0n ? null : (n - 1n).toString(16).padStart(64, "0");
  }
}
