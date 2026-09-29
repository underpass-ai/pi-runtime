import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class Timestamp extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static fromEpochMs(ms: number): Timestamp {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw DomainError.because(`invalid epoch ms ${ms}`);
    return new Timestamp(new Date(ms).toISOString());
  }
  static parse(raw: string): Timestamp {
    if (typeof raw !== "string" || !ISO.test(raw) || Number.isNaN(Date.parse(raw))) throw DomainError.because(`invalid timestamp "${raw}"`);
    return new Timestamp(raw);
  }
  epochMs(): number { return Date.parse(this.value); }
}
