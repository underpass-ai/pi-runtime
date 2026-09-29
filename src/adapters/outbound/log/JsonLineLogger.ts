import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import type { Clock } from "../../../application/ports/Clock.ts";
import type { HostLog } from "../../../application/ports/HostLog.ts";

type Fields = Record<string, string | number | boolean | null>;
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP = 3;
const PATHS = /(^|[\s'"`(=:,])(?:~|[A-Za-z]:)?[\\/][^\s'"`),]*/g;

// Log del host: una línea JSON por entrada (ts, level, msg, trace_id y span_id si vienen,
// y los campos). Rota a 10 MB conservando host.log.1 … host.log.3. Cualquier ruta o URL
// dentro de un texto (p. ej. el mensaje de un error de fs o de SQLite) se sustituye por
// <path>. Nunca lanza: sin log antes que sin host.
export class JsonLineLogger implements HostLog {
  readonly #path: string; readonly #clock: Clock; readonly #maxBytes: number;
  constructor(path: string, clock: Clock, maxBytes = MAX_BYTES) { this.#path = path; this.#clock = clock; this.#maxBytes = maxBytes; }

  info(message: string, fields: Fields = {}): void { this.#write("info", message, fields); }
  warn(message: string, fields: Fields = {}): void { this.#write("warn", message, fields); }
  error(message: string, fields: Fields = {}): void { this.#write("error", message, fields); }

  static scrub(text: string): string { return text.replace(PATHS, "$1<path>"); }

  #write(level: string, message: string, fields: Fields): void {
    const { trace_id: traceId, span_id: spanId, ...rest } = fields;
    const entry: Record<string, unknown> = { ts: this.#clock.now().value, level, msg: JsonLineLogger.scrub(message) };
    if (typeof traceId === "string") entry.trace_id = traceId;
    if (typeof spanId === "string") entry.span_id = spanId;
    for (const [k, v] of Object.entries(rest)) if (!(k in entry)) entry[k] = typeof v === "string" ? JsonLineLogger.scrub(v) : v;
    const line = `${JSON.stringify(entry)}\n`;
    try {
      this.#rotate(Buffer.byteLength(line));
      appendFileSync(this.#path, line, { mode: 0o600 });
    } catch { /* un log que no se puede escribir nunca tumba el host */ }
  }

  #rotate(incoming: number): void {
    if (!existsSync(this.#path) || statSync(this.#path).size + incoming <= this.#maxBytes) return;
    rmSync(`${this.#path}.${KEEP}`, { force: true });
    for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${this.#path}.${i}`)) renameSync(`${this.#path}.${i}`, `${this.#path}.${i + 1}`);
    renameSync(this.#path, `${this.#path}.1`);
  }
}
