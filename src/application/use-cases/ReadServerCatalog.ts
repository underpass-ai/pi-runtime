import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ServerPool } from "../services/ServerPool.ts";

export class ReadServerCatalog {
  readonly #pool: ServerPool;
  constructor(pool: ServerPool) { this.#pool = pool; }
  async execute(server: ServerName): Promise<ToolCatalog> { return (await this.#pool.connection(server)).catalog(); }
}
