import type { SessionId } from "../../domain/events/SessionId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Phase } from "../../domain/session/Phase.ts";
import type { CallContextDto } from "../dto/CallContextDto.ts";
import type { FactDto } from "../dto/FactDto.ts";
import type { SelectionDto } from "../dto/SelectionDto.ts";
import type { SessionStatusDto } from "../dto/SessionStatusDto.ts";
import type { ToolCallResultDto } from "../dto/ToolCallResultDto.ts";

export interface HostGateway {
  catalog(server: ServerName): Promise<ToolCatalog>;
  // context (S3a): sesión, fase y token de confirmación; sin él, el host no autoriza nada por su cuenta.
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>, context?: CallContextDto): Promise<ToolCallResultDto>;
  // Una confirmación de MADE rechazada o imposible (sin UI): el host la registra y anula su token.
  confirmation(id: SessionId, token: string, outcome: "declined" | "no_ui"): Promise<{ recorded: boolean }>;
  health(): Promise<{ project: string; started: string[] }>;
  record(fact: FactDto): Promise<void>;
  summary(id: SessionId): Promise<SessionStatusDto>;
  // deadline: instante a partir del cual la extensión ya no aplicará la respuesta (spec §7).
  select(id: SessionId, phase: Phase, deadline?: Timestamp, registered?: ToolName[]): Promise<SelectionDto>;
  close(): void;
  onClose(listener: () => void): void;
}
