import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Acción de autorización de MADE tal como la escribe una decisión (`get_status`, `read_budget`…).
export class MadeAction extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): MadeAction {
    if (typeof raw !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(raw)) throw DomainError.because(`invalid MADE action ${raw}`);
    return new MadeAction(raw);
  }
}
