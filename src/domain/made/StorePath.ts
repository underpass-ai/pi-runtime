import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class StorePath extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): StorePath {
    if (typeof raw !== "string" || !raw.startsWith("/")) throw DomainError.because(`store path must be absolute: ${raw}`);
    return new StorePath(raw);
  }
  configDigest(): string { return createHash("sha256").update(this.value).digest("hex").slice(0, 16); }
}
