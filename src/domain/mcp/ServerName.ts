import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ServerName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP = new ServerName("kmp");
  static readonly MADE = new ServerName("made");
  static of(raw: string): ServerName {
    if (raw === "kmp") return ServerName.KMP;
    if (raw === "made") return ServerName.MADE;
    throw DomainError.because(`unknown server ${raw}`);
  }
}
