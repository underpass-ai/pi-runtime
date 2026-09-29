import { NpmPackageName } from "../../domain/distribution/NpmPackageName.ts";
import { PackageCoordinate } from "../../domain/distribution/PackageCoordinate.ts";
import { SemVer } from "../../domain/distribution/SemVer.ts";
import type { ShrinkwrapDto } from "../dto/ShrinkwrapDto.ts";

export class ShrinkwrapMapper {
  toCoordinates(dto: ShrinkwrapDto): PackageCoordinate[] {
    const seen = new Map<string, PackageCoordinate>();
    for (const [path, entry] of Object.entries(dto.packages ?? {})) {
      if (path === "" || entry.link || !entry.version) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const c = PackageCoordinate.of(NpmPackageName.of(name), SemVer.of(entry.version));
      seen.set(c.key(), c);
    }
    return [...seen.values()];
  }
}
