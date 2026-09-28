import type { McpToolDto } from "./McpToolDto.ts";

export type CatalogDto = { server: string; serverName: string; serverVersion: string; fingerprint: string; tools: McpToolDto[] };
