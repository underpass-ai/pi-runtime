import { DomainError } from "../shared/DomainError.ts";
import type { SemVer } from "../distribution/SemVer.ts";

export class ServerIdentity {
  readonly name: string; readonly version: SemVer;
  private constructor(name: string, version: SemVer) { this.name = name; this.version = version; }
  static of(name: string, version: SemVer): ServerIdentity {
    if (!name.trim()) throw DomainError.because("server name must not be empty");
    return new ServerIdentity(name, version);
  }
}
