import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export interface HostGateway {
  catalog(server: ServerName): Promise<ToolCatalog>;
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto>;
  health(): Promise<{ project: string; started: string[] }>;
  close(): void;
  onClose(listener: () => void): void;
}
