import { closeSync, constants, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { TelemetryKeyError } from "../../../application/ports/TelemetryKeyError.ts";
import type { TelemetryKeyRepository } from "../../../application/ports/TelemetryKeyRepository.ts";
import { TelemetryKey } from "../../../domain/telemetry/TelemetryKey.ts";

const code = (e: unknown) => String((e as { code?: unknown }).code ?? "unknown");

// `<state>/telemetry.key`: 64 hex y salto de línea, 0600, del usuario. Se crea de forma
// atómica (temporal 0600 + link, que falla si ya existe): ningún lector ve un fichero a
// medias y dos procesos no se pisan. Los errores nunca repiten la ruta ni el contenido.
export class FsTelemetryKeyRepository implements TelemetryKeyRepository {
  readonly #file: string;
  constructor(file: string) {
    if (!isAbsolute(file)) throw TelemetryKeyError.because("telemetry key path must be absolute");
    this.#file = file;
  }

  load(): TelemetryKey | null {
    let fd: number;
    try { fd = openSync(this.#file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) {
      if (code(e) === "ENOENT") return null;
      if (code(e) === "ELOOP") throw TelemetryKeyError.because("telemetry key must not be a symlink");
      throw TelemetryKeyError.because(`telemetry key is unreadable (${code(e)})`);
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw TelemetryKeyError.because("telemetry key must be a regular file");
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw TelemetryKeyError.because("telemetry key must be owned by the current user");
      const mode = st.mode & 0o777;
      if (mode !== 0o600 && mode !== 0o400) throw TelemetryKeyError.because(`telemetry key has mode ${mode.toString(8)}; expected 600 or 400`);
      try { return TelemetryKey.of(readFileSync(fd, "utf8").trim()); }
      catch { throw TelemetryKeyError.because("telemetry key is malformed; delete it to generate a new one"); }
    } catch (e) {
      if (e instanceof TelemetryKeyError) throw e;
      throw TelemetryKeyError.because(`telemetry key is unreadable (${code(e)})`);
    } finally { closeSync(fd); }
  }

  create(key: TelemetryKey): void {
    const tmp = `${this.#file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
      const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeSync(fd, `${key.reveal()}\n`); fsyncSync(fd); } finally { closeSync(fd); }
      linkSync(tmp, this.#file);
    } catch (e) {
      if (code(e) === "EEXIST") throw TelemetryKeyError.exists();
      throw TelemetryKeyError.because(`telemetry key could not be created (${code(e)})`);
    } finally { rmSync(tmp, { force: true }); }
  }
}
