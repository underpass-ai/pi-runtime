import type { ProtocolVersion } from "../../domain/mcp/ProtocolVersion.ts";
import type { ServerIdentity } from "../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";

export interface McpConnection {
  readonly server: ServerName;
  readonly identity: ServerIdentity;
  readonly protocol: ProtocolVersion;
  catalog(): Promise<ToolCatalog>;
  call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome>;
  // code: código de salida del proceso, null si no se conoce (señal, error al arrancar, stdin roto).
  onExit(listener: (code: number | null) => void): void;
  close(): Promise<void>;
}
