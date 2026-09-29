import { spawn } from "node:child_process";
import type { McpConnector } from "../../../application/ports/McpConnector.ts";
import type { McpConnection } from "../../../application/ports/McpConnection.ts";
import type { ServerCommandDto } from "../../../application/dto/ServerCommandDto.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { StdioMcpConnection } from "./StdioMcpConnection.ts";

export class StdioMcpConnector implements McpConnector {
  readonly #timeoutMs: number;
  constructor(requestTimeoutMs = 60_000) { this.#timeoutMs = requestTimeoutMs; }
  async open(server: ServerName, cmd: ServerCommandDto): Promise<McpConnection> {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: cmd.env, stdio: ["pipe", "pipe", "pipe"] });
    const conn = new StdioMcpConnection(server, child, this.#timeoutMs);
    try {
      await conn.handshake();
      return conn;
    } catch (err) {
      await conn.close();
      throw err;
    }
  }
}
