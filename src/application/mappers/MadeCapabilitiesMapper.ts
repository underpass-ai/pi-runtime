import { DomainError } from "../../domain/shared/DomainError.ts";
import { SemVer } from "../../domain/distribution/SemVer.ts";
import { CapabilityGroupId } from "../../domain/made/CapabilityGroupId.ts";
import { DeclaredLimitId } from "../../domain/made/DeclaredLimitId.ts";
import { MadeCapabilities } from "../../domain/made/MadeCapabilities.ts";
import type { MadeCapabilitiesDto } from "../dto/MadeCapabilitiesDto.ts";

export class MadeCapabilitiesMapper {
  toDomain(dto: MadeCapabilitiesDto): MadeCapabilities {
    if (dto.schema_version !== "1.0") throw DomainError.because(`made capabilities: unsupported schema_version ${dto.schema_version}`);
    return MadeCapabilities.of({
      serverVersion: SemVer.of(dto.server?.version ?? "0.0.0"),
      toolCount: dto.tool_count ?? 0,
      groups: (dto.capabilities ?? []).map((c) => CapabilityGroupId.of(c.id)),
      limits: (dto.declared_limits ?? []).map((l) => DeclaredLimitId.of(l.id)),
      activationAdapter: dto.host_activation?.adapter ?? null,
    });
  }
}
