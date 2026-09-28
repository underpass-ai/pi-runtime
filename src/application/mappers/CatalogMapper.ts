import { SemVer } from "../../domain/distribution/SemVer.ts";
import { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { CatalogDto } from "../dto/CatalogDto.ts";
import { McpToolMapper } from "./McpToolMapper.ts";

export class CatalogMapper {
  readonly #tools = new McpToolMapper();
  toDto(c: ToolCatalog): CatalogDto {
    return { server: c.server.value, serverName: c.identity.name, serverVersion: c.identity.version.value, fingerprint: c.fingerprint().value, tools: c.tools().map((t) => this.#tools.toDto(t)) };
  }
  toDomain(dto: CatalogDto): ToolCatalog {
    return ToolCatalog.of(ServerName.of(dto.server), ServerIdentity.of(dto.serverName, SemVer.of(dto.serverVersion)), dto.tools.map((t) => this.#tools.toDomain(t)));
  }
}
