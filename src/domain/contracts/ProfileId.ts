import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const KNOWN = ["kmp-interactive", "kmp-projection", "made-session", "made-worker"];

export class ProfileId extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static readonly KMP_INTERACTIVE = new ProfileId("kmp-interactive");
  static readonly KMP_PROJECTION = new ProfileId("kmp-projection");
  static readonly MADE_SESSION = new ProfileId("made-session");
  static readonly MADE_WORKER = new ProfileId("made-worker");
  static of(raw: string): ProfileId {
    if (!KNOWN.includes(raw)) throw DomainError.because(`unknown profile ${raw}`);
    return new ProfileId(raw);
  }
}
