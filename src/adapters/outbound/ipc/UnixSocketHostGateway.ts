import { connect, type Socket } from "node:net";
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";
import type { CatalogDto } from "../../../application/dto/CatalogDto.ts";
import type { ToolCallResultDto } from "../../../application/dto/ToolCallResultDto.ts";
import { CatalogMapper } from "../../../application/mappers/CatalogMapper.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../../domain/mcp/ToolName.ts";
import { LineFramer } from "../../ipc/LineFramer.ts";
import { HostCallError } from "../../../application/ports/HostCallError.ts";

export class UnixSocketHostGateway implements HostGateway {
  readonly #sock: Socket; readonly #pending = new Map<number, (r: HostResponseDto) => void>(); #nextId = 1;

  private constructor(sock: Socket) {
    this.#sock = sock;
    const fail = (message: string) => {
      for (const cb of this.#pending.values()) cb({ id: -1, ok: false, error: { kind: "transport", message } });
      this.#pending.clear();
    };
    const framer = new LineFramer(
      (line) => {
        let res: HostResponseDto;
        try { res = JSON.parse(line) as HostResponseDto; }
        catch { fail("malformed response from host"); sock.destroy(); return; }
        this.#pending.get(res.id)?.(res);
        this.#pending.delete(res.id);
      },
      () => sock.destroy(),
    );
    sock.on("data", (chunk) => framer.push(chunk));
    sock.on("close", () => fail("host connection closed"));
    sock.on("error", () => fail("host connection closed"));
  }

  static async connect(path: string, retries = 0, delayMs = 100): Promise<UnixSocketHostGateway> {
    for (let i = 0; ; i++) {
      try {
        return new UnixSocketHostGateway(await new Promise<Socket>((resolve, reject) => { const s = connect(path, () => resolve(s)); s.once("error", reject); }));
      } catch (e) {
        if (i >= retries) throw e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  async catalog(server: ServerName): Promise<ToolCatalog> { return new CatalogMapper().toDomain(await this.raw<CatalogDto>({ method: "catalog", server: server.value })); }
  call(server: ServerName, tool: ToolName, args: Record<string, unknown>): Promise<ToolCallResultDto> { return this.raw({ method: "call", server: server.value, tool: tool.value, args }); }
  health(): Promise<{ project: string; started: string[] }> { return this.raw({ method: "health" }); }
  close(): void { this.#sock.end(); }

  raw<T>(req: Record<string, unknown>): Promise<T> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (res) => (res.ok ? resolve(res.result as T) : reject(new HostCallError(res.error.kind, res.error.message, res.error.code))));
      this.#sock.write(JSON.stringify({ ...req, id }) + "\n");
    });
  }
}
