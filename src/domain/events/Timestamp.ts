import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Último instante con año de 4 dígitos: más allá toISOString da "+033658-…Z",
// que parse rechaza, y un hecho así envenenaría la lectura de su stream.
const MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export class Timestamp extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static fromEpochMs(ms: number): Timestamp {
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > MAX_MS) throw DomainError.because(`invalid epoch ms ${ms}`);
    return new Timestamp(new Date(ms).toISOString());
  }
  static parse(raw: string): Timestamp {
    if (typeof raw !== "string" || !ISO.test(raw) || Number.isNaN(Date.parse(raw))) throw DomainError.because(`invalid timestamp "${raw}"`);
    return new Timestamp(raw);
  }
  epochMs(): number { return Date.parse(this.value); }
}
