import { BinaryName } from "../../domain/distribution/BinaryName.ts";
import { BinaryPin } from "../../domain/distribution/BinaryPin.ts";
import { NpmPackageName } from "../../domain/distribution/NpmPackageName.ts";
import { PiPin } from "../../domain/distribution/PiPin.ts";
import { PinSet } from "../../domain/distribution/PinSet.ts";
import { RepositorySlug } from "../../domain/distribution/RepositorySlug.ts";
import { SemVer } from "../../domain/distribution/SemVer.ts";
import { Sha256Digest } from "../../domain/distribution/Sha256Digest.ts";
import { Sha512Integrity } from "../../domain/distribution/Sha512Integrity.ts";
import { Target } from "../../domain/distribution/Target.ts";
import type { PinSetDto } from "../dto/PinSetDto.ts";

export class PinSetMapper {
  toDomain(dto: PinSetDto): PinSet {
    const pi = PiPin.of({ packageName: NpmPackageName.of(dto.pi.package), version: SemVer.of(dto.pi.version), integrity: Sha512Integrity.of(dto.pi.integrity) });
    const binaries = dto.binaries.map((b) => BinaryPin.of({
      name: BinaryName.of(b.name),
      version: SemVer.of(b.version),
      repository: RepositorySlug.of(b.repo),
      digests: new Map(Object.entries(b.sha256).map(([t, d]) => [Target.of(t).value, Sha256Digest.of(d)])),
    }));
    return PinSet.of(pi, binaries);
  }
}
