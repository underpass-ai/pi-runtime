import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpConnection } from "../../../application/ports/McpConnection.ts";
import type { McpToolDto } from "../../../application/dto/McpToolDto.ts";
import type { McpToolResultDto } from "../../../application/dto/McpToolResultDto.ts";
import { McpToolMapper } from "../../../application/mappers/McpToolMapper.ts";
import { ToolOutcomeMapper } from "../../../application/mappers/ToolOutcomeMapper.ts";
import { SemVer } from "../../../domain/distribution/SemVer.ts";
import { ProtocolVersion } from "../../../domain/mcp/ProtocolVersion.ts";
import { ServerIdentity } from "../../../domain/mcp/ServerIdentity.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import { ToolCatalog } from "../../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../../domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../../domain/mcp/ToolOutcome.ts";
import { McpRpcError } from "./McpRpcError.ts";
import { McpTransportError } from "./McpTransportError.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class StdioMcpConnection implements McpConnection {
  readonly server: ServerName;
  identity = ServerIdentity.of("unknown", SemVer.of("0.0.0"));
  protocol = ProtocolVersion.MCP_2024_11_05;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #timeoutMs: number;
  readonly #graceMs: number;
  readonly #pending = new Map<number, Pending>();
  readonly #exitListeners: ((code: number | null) => void)[] = [];
  #nextId = 1;
  #exited = false;
  #stderrTail = "";

  // graceMs: espera tras cerrar stdin antes de SIGTERM, y tras SIGTERM antes de SIGKILL.
  constructor(server: ServerName, child: ChildProcessWithoutNullStreams, timeoutMs: number, graceMs = 2000) {
    this.server = server; this.#child = child; this.#timeoutMs = timeoutMs; this.#graceMs = graceMs;
    createInterface({ input: child.stdout }).on("line", (l) => this.#onLine(l));
    child.stderr.on("data", (chunk: Buffer) => { this.#stderrTail = (this.#stderrTail + chunk.toString()).slice(-4096); });
    child.on("exit", (code) => this.#down(`${server} exited (${code}); outcome unknown${this.#stderrSuffix()}`, code));
    child.on("error", (err) => this.#down(`${server} failed to start: ${err.message}`));
    // Sin este oyente, un EPIPE al escribir a un hijo que ya murió sería una
    // excepción no capturada que tumba el host entero.
    child.stdin.on("error", (err) => this.#down(`${server} stdin failed: ${err.message}; outcome unknown${this.#stderrSuffix()}`));
  }

  #stderrSuffix(): string {
    const tail = this.#stderrTail.trim();
    return tail ? `; stderr: ${tail}` : "";
  }

  #down(message: string, code: number | null = null): void {
    if (this.#exited) return;
    this.#exited = true;
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new McpTransportError(message)); }
    this.#pending.clear();
    for (const l of this.#exitListeners) l(code);
  }

  async handshake(): Promise<void> {
    const init = (await this.#request("initialize", { protocolVersion: ProtocolVersion.MCP_2024_11_05.value, capabilities: {}, clientInfo: { name: "pi-runtime", version: "0.1.0" } })) as
      { protocolVersion: string; serverInfo: { name: string; version: string } };
    this.protocol = ProtocolVersion.of(init.protocolVersion);
    this.identity = ServerIdentity.of(init.serverInfo.name, SemVer.of(init.serverInfo.version));
    this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  }

  async catalog(): Promise<ToolCatalog> {
    const { tools } = (await this.#request("tools/list", {})) as { tools: McpToolDto[] };
    const mapper = new McpToolMapper();
    return ToolCatalog.of(this.server, this.identity, tools.map((t) => mapper.toDomain(t)));
  }

  async call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    return new ToolOutcomeMapper().toDomain((await this.#request("tools/call", { name: tool.value, arguments: args })) as McpToolResultDto);
  }

  onExit(listener: (code: number | null) => void): void { this.#exitListeners.push(listener); }

  async close(): Promise<void> {
    if (this.#exited) return;
    const done = new Promise<void>((r) => this.#child.once("exit", () => r()));
    this.#child.stdin.end();
    let hard: NodeJS.Timeout | undefined;
    const term = setTimeout(() => {
      this.#child.kill("SIGTERM");
      hard = setTimeout(() => this.#child.kill("SIGKILL"), this.#graceMs);
    }, this.#graceMs);
    await done;
    clearTimeout(term);
    clearTimeout(hard);
  }

  #request(method: string, params: unknown): Promise<unknown> {
    if (this.#exited) return Promise.reject(new McpTransportError(`${this.server} not running`));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new McpTransportError(`${method} timed out after ${this.#timeoutMs}ms; outcome unknown`)); }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  #onLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string } };
    try { msg = JSON.parse(line); } catch { return; }
    const p = msg.id === undefined ? undefined : this.#pending.get(msg.id);
    if (!p) return;
    this.#pending.delete(msg.id!);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new McpRpcError(msg.error.code, msg.error.message)); else p.resolve(msg.result);
  }
}
