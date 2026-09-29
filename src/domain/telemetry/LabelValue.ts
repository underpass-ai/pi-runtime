import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SAFE = /^[A-Za-z0-9_.:-]{1,64}$/;

// Valor de label con cardinalidad acotada: lo que no cabe en [A-Za-z0-9_.:-]{1,64}
// es `other` (nunca texto libre, rutas ni mensajes de error).
export class LabelValue extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly OTHER = new LabelValue("other");
  static readonly UNKNOWN = new LabelValue("unknown");

  static of(raw: string): LabelValue {
    if (typeof raw !== "string") throw DomainError.because("label value must be a string");
    return SAFE.test(raw) ? new LabelValue(raw) : LabelValue.OTHER;
  }

  // Para payloads tolerantes: ausente o vacío es `unknown`; un entero (código de salida) se escribe como texto.
  static orUnknown(raw: unknown): LabelValue {
    if (raw === null || raw === undefined || raw === "") return LabelValue.UNKNOWN;
    if (typeof raw === "number" && Number.isInteger(raw)) return LabelValue.of(String(raw));
    return typeof raw === "string" ? LabelValue.of(raw) : LabelValue.OTHER;
  }
}
