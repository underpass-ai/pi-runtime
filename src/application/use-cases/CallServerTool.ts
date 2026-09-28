import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../domain/mcp/ToolOutcome.ts";
import type { ServerPool } from "../services/ServerPool.ts";

export class CallServerTool {
  readonly #pool: ServerPool;
  constructor(pool: ServerPool) { this.#pool = pool; }
  async execute(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    return (await this.#pool.connection(server)).call(tool, args);
  }
}
