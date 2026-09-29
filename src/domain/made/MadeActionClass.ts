import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const HOUR_MS = 3_600_000;

// Clase de una acción de MADE (S3a §1): auto (lectura o borrador, grant hasta el cierre de la
// sesión con tope de 12 h), confirm (escribe o ejecuta: confirmación humana y grant de 5 min)
// o never (administración de la autorización: nunca desde Pi).
export class MadeActionClass extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly AUTO = new MadeActionClass("auto");
  static readonly CONFIRM = new MadeActionClass("confirm");
  static readonly NEVER = new MadeActionClass("never");

  static of(raw: string): MadeActionClass {
    const found = [MadeActionClass.AUTO, MadeActionClass.CONFIRM, MadeActionClass.NEVER].find((c) => c.value === raw);
    if (typeof raw !== "string" || found === undefined) throw DomainError.because(`unknown MADE action class ${raw}`);
    return found;
  }

  // Vigencia del grant que la acción justifica.
  lifetimeMs(): number {
    if (this.equals(MadeActionClass.AUTO)) return 12 * HOUR_MS;
    if (this.equals(MadeActionClass.CONFIRM)) return 5 * 60_000;
    throw DomainError.because("a never action is never granted");
  }
}
