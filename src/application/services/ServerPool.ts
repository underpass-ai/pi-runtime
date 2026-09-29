import type { ServerName } from "../../domain/mcp/ServerName.ts";
import type { Project } from "../../domain/project/Project.ts";
import type { McpConnection } from "../ports/McpConnection.ts";
import type { McpConnector } from "../ports/McpConnector.ts";
import type { ServerCommandFactory } from "../ports/ServerCommandFactory.ts";

export class ServerPool {
  readonly #project: Project; readonly #connector: McpConnector; readonly #commands: Map<string, ServerCommandFactory>;
  readonly #open = new Map<string, { server: ServerName; conn: Promise<McpConnection> }>();
  #closed = false;

  constructor(project: Project, connector: McpConnector, commands: Map<string, ServerCommandFactory>) {
    this.#project = project; this.#connector = connector; this.#commands = commands;
  }

  connection(server: ServerName): Promise<McpConnection> {
    if (this.#closed) return Promise.reject(new Error("server pool closed"));
    const existing = this.#open.get(server.value);
    if (existing) return existing.conn;
    const factory = this.#commands.get(server.value);
    if (!factory) return Promise.reject(new Error(`no command for ${server}`));
    const conn = this.#connector.open(server, factory.commandFor(this.#project)).then(async (c) => {
      if (this.#closed) { await c.close(); throw new Error("server pool closed"); }
      c.onExit(() => this.#open.delete(server.value));
      return c;
    });
    conn.catch(() => this.#open.delete(server.value));
    this.#open.set(server.value, { server, conn });
    return conn;
  }

  started(): ServerName[] { return [...this.#open.values()].map((e) => e.server); }

  async close(): Promise<void> {
    this.#closed = true;
    const all = [...this.#open.values()];
    this.#open.clear();
    await Promise.allSettled(all.map(async (e) => (await e.conn).close()));
  }
}
