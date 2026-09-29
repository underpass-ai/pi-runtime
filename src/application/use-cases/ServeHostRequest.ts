import { ServerName } from "../../domain/mcp/ServerName.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { Project } from "../../domain/project/Project.ts";
import type { HostRequestDto } from "../dto/HostRequestDto.ts";
import type { HostResponseDto } from "../dto/HostResponseDto.ts";
import { CatalogMapper } from "../mappers/CatalogMapper.ts";
import { HostResponseMapper } from "../mappers/HostResponseMapper.ts";
import { ToolOutcomeMapper } from "../mappers/ToolOutcomeMapper.ts";
import type { ServerPool } from "../services/ServerPool.ts";
import { CallServerTool } from "./CallServerTool.ts";
import { ReadServerCatalog } from "./ReadServerCatalog.ts";

export class ServeHostRequest {
  readonly #project: Project; readonly #pool: ServerPool; readonly #responses = new HostResponseMapper();
  constructor(project: Project, pool: ServerPool) { this.#project = project; this.#pool = pool; }

  async execute(req: HostRequestDto): Promise<HostResponseDto> {
    if (req.method === "health") return this.#responses.success(req.id, { project: this.#project.root.value, started: this.#pool.started().map(String) });
    let server: ServerName; let tool: ToolName | null = null;
    try {
      server = ServerName.of(req.server);
      if (req.method === "call") tool = ToolName.of(req.tool);
    } catch (e) {
      return this.#responses.invalid(req.id, (e as Error).message);
    }
    try {
      if (req.method === "catalog") return this.#responses.success(req.id, new CatalogMapper().toDto(await new ReadServerCatalog(this.#pool).execute(server)));
      const outcome = await new CallServerTool(this.#pool).execute(server, tool!, (req as { args: Record<string, unknown> }).args ?? {});
      if (outcome instanceof ToolRefusal) return this.#responses.refusal(req.id, outcome);
      return this.#responses.success(req.id, new ToolOutcomeMapper().toDto(outcome));
    } catch (e) {
      return this.#responses.failure(req.id, e);
    }
  }
}
