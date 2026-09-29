import { connect, type Socket } from "node:net";
import type { HostGateway } from "../../../application/ports/HostGateway.ts";
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";
import type { CatalogDto } from "../../../application/dto/CatalogDto.ts";
import type { ToolCallResultDto } from "../../../application/dto/ToolCallResultDto.ts";
import type { FactDto } from "../../../application/dto/FactDto.ts";
import type { SessionStatusDto } from "../../../application/dto/SessionStatusDto.ts";
import type { SelectionDto } from "../../../application/dto/SelectionDto.ts";
import type { Phase } from "../../../domain/session/Phase.ts";
import type { SessionId } from "../../../domain/events/SessionId.ts";
import type { Timestamp } from "../../../domain/events/Timestamp.ts";
import { CatalogMapper } from "../../../application/mappers/CatalogMapper.ts";
import type { ServerName } from "../../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../../domain/mcp/ToolName.ts";
import { LineFramer } from "../../ipc/LineFramer.ts";
import { HostCallError } from "../../../application/ports/HostCallError.ts";

export class UnixSocketHostGateway implements HostGateway {
  readonly #sock: Socket; readonly #pending = new Map<number, (r: HostResponseDto) => void>(); #nextId = 1;
  readonly #closeListeners: (() => void)[] = []; #closed = false;

  private constructor(sock: Socket) {
    this.#sock = sock;
    const fail = (message: string) => {
      for (const cb of this.#pending.values()) cb({ id: -1, ok: false, error: { kind: "transport", message } });
      this.#pending.clear();
    };
    const closed = () => {
      fail("host connection closed");
      if (this.#closed) return;
      this.#closed = true;
      for (const l of this.#closeListeners.splice(0)) l();
    };
    const framer = new LineFramer(
      (line) => {
        let res: unknown;
        try { res = JSON.parse(line); } catch { res = null; }
        if (typeof res !== "object" || res === null) { fail("malformed response from host"); sock.destroy(); return; }
        const r = res as HostResponseDto;
        this.#pending.get(r.id)?.(r);
        this.#pending.delete(r.id);
      },
      () => sock.destroy(),
    );
    sock.on("data", (chunk) => framer.push(chunk));
    sock.on("close", closed);
    sock.on("error", closed);
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
  record(fact: FactDto): Promise<void> { return this.raw({ method: "record", fact }).then(() => undefined); }
  summary(id: SessionId): Promise<SessionStatusDto> { return this.raw({ method: "summary", sessionId: id.value }); }
  select(id: SessionId, phase: Phase, deadline?: Timestamp): Promise<SelectionDto> { return this.raw({ method: "select", sessionId: id.value, phase: phase.value, deadlineMs: deadline?.epochMs() }); }
  close(): void { this.#sock.end(); }

  // Avisa cuando la conexión con el host se cierra (host muerto, error o
  // close() propio). Un oyente tardío se avisa en la siguiente vuelta.
  onClose(listener: () => void): void {
    if (this.#closed) setImmediate(listener);
    else this.#closeListeners.push(listener);
  }

  raw<T>(req: Record<string, unknown>): Promise<T> {
    if (this.#closed || this.#sock.destroyed || !this.#sock.writable) {
      return Promise.reject(new HostCallError("transport", "host connection closed"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (res) => (res.ok ? resolve(res.result as T) : reject(new HostCallError(res.error.kind, res.error.message, res.error.code))));
      this.#sock.write(JSON.stringify({ ...req, id }) + "\n");
    });
  }
}
