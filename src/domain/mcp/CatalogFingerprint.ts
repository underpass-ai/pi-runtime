import { createHash } from "node:crypto";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class CatalogFingerprint extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): CatalogFingerprint {
    if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) throw DomainError.because("catalog fingerprint must be 64 hex characters");
    return new CatalogFingerprint(raw);
  }
  static digest(canonical: string): CatalogFingerprint { return new CatalogFingerprint(createHash("sha256").update(canonical).digest("hex")); }
  short(): string { return this.value.slice(0, 12); }
}
