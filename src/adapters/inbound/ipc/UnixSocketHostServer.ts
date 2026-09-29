import { randomBytes } from "node:crypto";
import { chmodSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import type { HostRequestDto } from "../../../application/dto/HostRequestDto.ts";
import type { HostResponseDto } from "../../../application/dto/HostResponseDto.ts";
import { LineFramer } from "../../ipc/LineFramer.ts";

const ALLOWED = new Set(["call", "catalog", "health"]);
// sun_path admite 104–108 bytes según el sistema; 100 deja margen en todos.
const MAX_SOCKET_PATH_BYTES = 100;
type Handler = (req: HostRequestDto) => Promise<HostResponseDto>;

function requirePrivateDir(path: string): void {
  const dir = dirname(path);
  let st: ReturnType<typeof statSync>;
  try { st = statSync(dir); } catch { throw new Error(`refusing to listen: socket directory ${dir} does not exist`); }
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
    throw new Error(`refusing to listen: socket directory ${dir} is not owned by the current user`);
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error(`refusing to listen: socket directory ${dir} must not be group/other accessible (mode ${(st.mode & 0o777).toString(8)})`);
  }
}

export class UnixSocketHostServer {
  readonly #server: Server; readonly #path: string; readonly #sockets = new Set<Socket>();
  #identity: { ino: number; dev: number } | null = null;

  private constructor(server: Server, path: string) { this.#server = server; this.#path = path; }

  // Se escucha en un nombre temporal y se renombra a `path`: libuv borra al
  // cerrar la ruta con la que se escuchó, sea quien sea quien esté ahí; así
  // ese borrado cae sobre el temporal (ya inexistente) y el de `path` lo
  // decide #unlinkIfOurs comparando inodos.
  static async start(path: string, handle: Handler): Promise<UnixSocketHostServer> {
    if (Buffer.byteLength(path) > MAX_SOCKET_PATH_BYTES) {
      throw new Error(`socket path too long (${Buffer.byteLength(path)} bytes > ${MAX_SOCKET_PATH_BYTES}): ${path}; set XDG_STATE_HOME to a shorter absolute directory`);
    }
    requirePrivateDir(path);
    const listenPath = join(dirname(path), `.${randomBytes(3).toString("hex")}`);
    let self: UnixSocketHostServer;
    const server = createServer((sock) => self.#accept(sock, handle));
    self = new UnixSocketHostServer(server, path);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(listenPath, () => resolve()); });
    chmodSync(listenPath, 0o600);
    renameSync(listenPath, path);
    const st = statSync(path);
    self.#identity = { ino: st.ino, dev: st.dev };
    return self;
  }

  clients(): number { return this.#sockets.size; }

  close(): Promise<void> {
    return new Promise((resolve) => { for (const s of this.#sockets) s.destroy(); this.#server.close(() => { this.#unlinkIfOurs(); resolve(); }); });
  }

  // Sólo borra el socket si sigue siendo el nuestro (mismo inodo y
  // dispositivo que al escuchar): otro host puede haberlo sustituido.
  #unlinkIfOurs(): void {
    let st: ReturnType<typeof statSync>;
    try { st = statSync(this.#path); } catch { return; }
    if (this.#identity && st.ino === this.#identity.ino && st.dev === this.#identity.dev) rmSync(this.#path, { force: true });
  }

  #accept(sock: Socket, handle: Handler): void {
    this.#sockets.add(sock);
    sock.on("close", () => this.#sockets.delete(sock));
    sock.on("error", () => sock.destroy());
    const framer = new LineFramer(
      async (line) => {
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { return; }
        if (typeof parsed !== "object" || parsed === null) return; // null, números o strings: se ignoran
        const req = parsed as { id?: number; method?: string };
        const id = typeof req.id === "number" ? req.id : -1;
        const res: HostResponseDto = !ALLOWED.has(req.method ?? "")
          ? { id, ok: false, error: { kind: "denied", message: `method ${req.method} not allowed` } }
          : await handle(req as HostRequestDto).catch((e): HostResponseDto => ({ id, ok: false, error: { kind: "transport", message: String(e) } }));
        if (!sock.destroyed) sock.write(JSON.stringify(res) + "\n");
      },
      () => sock.destroy(),
    );
    sock.on("data", (chunk) => framer.push(chunk));
  }
}
