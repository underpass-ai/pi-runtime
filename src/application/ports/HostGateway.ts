import type { SessionId } from "../../domain/events/SessionId.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { FactDto } from "../dto/FactDto.ts";
import type { SessionSummaryDto } from "../dto/SessionSummaryDto.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export interface HostGateway {
  catalog(server: ServerName): Promise<ToolCatalog>;
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto>;
  health(): Promise<{ project: string; started: string[] }>;
  record(fact: FactDto): Promise<void>;
  summary(id: SessionId): Promise<SessionSummaryDto | null>;
  close(): void;
  onClose(listener: () => void): void;
}
