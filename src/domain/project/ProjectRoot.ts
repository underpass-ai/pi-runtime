import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class ProjectRoot extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): ProjectRoot {
    if (typeof raw !== "string" || !raw.startsWith("/")) throw DomainError.because(`project root must be absolute: ${raw}`);
    return new ProjectRoot(raw.replace(/\/+$/, "") || "/");
  }
}
