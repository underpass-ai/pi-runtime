import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

export class RepositorySlug extends ValueObject<string> {
  private constructor(v: string) { super(v); }
  static of(raw: string): RepositorySlug {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) throw DomainError.because(`invalid repository ${raw}`);
    return new RepositorySlug(raw);
  }
}
