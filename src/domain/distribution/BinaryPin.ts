import { DomainError } from "../shared/DomainError.ts";
import type { BinaryName } from "./BinaryName.ts";
import type { RepositorySlug } from "./RepositorySlug.ts";
import type { SemVer } from "./SemVer.ts";
import type { Sha256Digest } from "./Sha256Digest.ts";
import { Target } from "./Target.ts";

type Props = { name: BinaryName; version: SemVer; repository: RepositorySlug; digests: Map<string, Sha256Digest> };

export class BinaryPin {
  readonly name: BinaryName;
  readonly version: SemVer;
  readonly repository: RepositorySlug;
  readonly #digests: Map<string, Sha256Digest>;

  private constructor(p: Props) { this.name = p.name; this.version = p.version; this.repository = p.repository; this.#digests = p.digests; }

  static of(p: Props): BinaryPin {
    for (const t of Target.all()) if (!p.digests.has(t.value)) throw DomainError.because(`${p.name} has no digest for ${t}`);
    return new BinaryPin(p);
  }

  digestFor(target: Target): Sha256Digest { return this.#digests.get(target.value)!; }
  assetName(target: Target): string { return `${this.name}-v${this.version}-${target}`; }
  releaseUrl(target: Target): URL { return new URL(`https://github.com/${this.repository}/releases/download/v${this.version}/${this.assetName(target)}`); }
  installedFileName(): string { return `${this.name}-${this.version}`; }
}
