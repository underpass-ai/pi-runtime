import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

// Sólo UNSET y ERROR: `refused` y `aborted` no son errores del sistema y salen UNSET con su pi_runtime.status.
export class SpanStatus extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly UNSET = new SpanStatus("unset");
  static readonly ERROR = new SpanStatus("error");
  static of(raw: string): SpanStatus {
    if (raw === "unset") return SpanStatus.UNSET;
    if (raw === "error") return SpanStatus.ERROR;
    throw DomainError.because(`unknown span status ${raw}`);
  }
  isError(): boolean { return this.equals(SpanStatus.ERROR); }
}
