import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ServerCommandDto } from "../dto/ServerCommandDto.ts";
import type { McpConnection } from "./McpConnection.ts";

export interface McpConnector { open(server: ServerName, command: ServerCommandDto): Promise<McpConnection>; }
