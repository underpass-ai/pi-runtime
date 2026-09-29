import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class NpmPackageName extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): NpmPackageName {
    if (typeof raw !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(raw)) throw DomainError.because(`invalid npm package name ${raw}`);
    return new NpmPackageName(raw);
  }
}
