import type { NpmPackageName } from "./NpmPackageName.ts";
import type { SemVer } from "./SemVer.ts";

export class PackageCoordinate {
  readonly name: NpmPackageName; readonly version: SemVer;
  private constructor(name: NpmPackageName, version: SemVer) { this.name = name; this.version = version; }
  static of(name: NpmPackageName, version: SemVer): PackageCoordinate { return new PackageCoordinate(name, version); }
  key(): string { return `${this.name}@${this.version}`; }
}
