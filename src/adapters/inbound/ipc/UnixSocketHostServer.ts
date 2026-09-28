import { chmodSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import type { HostRequestDto } from "../../../application/dto/HostRequestDto.ts";
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";

const ALLOWED = new Set(["call", "catalog", "health"]);
type Handler = (req: HostRequestDto) => Promise<HostResponseDto>;

// readline.createInterface can throw an uncatchable ECONNRESET when the peer
// destroys the socket mid-read; buffer lines manually on 'data' instead.
function onLines(sock: Socket, onLine: (line: string) => void): void {
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.length > 0) onLine(line);
    }
  });
}

export class UnixSocketHostServer {
  readonly #server: Server; readonly #path: string; readonly #sockets = new Set<Socket>();

  private constructor(server: Server, path: string) { this.#server = server; this.#path = path; }

  static async start(path: string, handle: Handler): Promise<UnixSocketHostServer> {
    rmSync(path, { force: true });
    let self: UnixSocketHostServer;
    const server = createServer((sock) => self.#accept(sock, handle));
    self = new UnixSocketHostServer(server, path);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); });
    chmodSync(path, 0o600);
    return self;
  }

  clients(): number { return this.#sockets.size; }

  close(): Promise<void> {
    return new Promise((resolve) => { for (const s of this.#sockets) s.destroy(); this.#server.close(() => { rmSync(this.#path, { force: true }); resolve(); }); });
  }

  #accept(sock: Socket, handle: Handler): void {
    this.#sockets.add(sock);
    sock.on("close", () => this.#sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    onLines(sock, async (line) => {
      let req: { id?: number; method?: string };
      try { req = JSON.parse(line); } catch { return; }
      const id = typeof req.id === "number" ? req.id : -1;
      const res: HostResponseDto = !ALLOWED.has(req.method ?? "")
        ? { id, ok: false, error: { kind: "denied", message: `method ${req.method} not allowed` } }
        : await handle(req as HostRequestDto).catch((e): HostResponseDto => ({ id, ok: false, error: { kind: "transport", message: String(e) } }));
      if (!sock.destroyed) sock.write(JSON.stringify(res) + "\n");
    });
  }
}
