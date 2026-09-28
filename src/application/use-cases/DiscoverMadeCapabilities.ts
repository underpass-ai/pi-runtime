import { DomainError } from "../../domain/shared/DomainError.ts";
import type { MadeCapabilities } from "../../domain/made/MadeCapabilities.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { MadeCapabilitiesDto } from "../dto/MadeCapabilitiesDto.ts";
import { MadeCapabilitiesMapper } from "../mappers/MadeCapabilitiesMapper.ts";
import type { McpConnection } from "../ports/McpConnection.ts";

export class DiscoverMadeCapabilities {
  async execute(connection: McpConnection): Promise<MadeCapabilities> {
    const outcome = await connection.call(ToolName.of("made_discover_capabilities"), {});
    if (outcome instanceof ToolRefusal) throw DomainError.because(`made_discover_capabilities refused: ${outcome.describe()}`);
    return new MadeCapabilitiesMapper().toDomain(outcome.structured as MadeCapabilitiesDto);
  }
}
