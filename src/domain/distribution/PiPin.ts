import type { NpmPackageName } from "./NpmPackageName.ts";
import type { SemVer } from "./SemVer.ts";
import type { Sha512Integrity } from "./Sha512Integrity.ts";

type Props = { packageName: NpmPackageName; version: SemVer; integrity: Sha512Integrity };

export class PiPin {
  readonly packageName: NpmPackageName;
  readonly version: SemVer;
  readonly integrity: Sha512Integrity;
  private constructor(p: Props) { this.packageName = p.packageName; this.version = p.version; this.integrity = p.integrity; }
  static of(p: Props): PiPin { return new PiPin(p); }
}
