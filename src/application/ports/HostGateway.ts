import type { SessionId } from "../../domain/events/SessionId.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Phase } from "../../domain/session/Phase.ts";
import type { FactDto } from "../dto/FactDto.ts";
import type { SelectionDto } from "../dto/SelectionDto.ts";
import type { SessionStatusDto } from "../dto/SessionStatusDto.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export interface HostGateway {
  catalog(server: ServerName): Promise<ToolCatalog>;
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto>;
  health(): Promise<{ project: string; started: string[] }>;
  record(fact: FactDto): Promise<void>;
  summary(id: SessionId): Promise<SessionStatusDto>;
  select(id: SessionId, phase: Phase): Promise<SelectionDto>;
  close(): void;
  onClose(listener: () => void): void;
}
