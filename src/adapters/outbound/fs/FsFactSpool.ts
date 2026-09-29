import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FactDto } from "../../../application/dto/FactDto.ts";
import type { FactSpool } from "../../../application/ports/FactSpool.ts";

// Spool por proceso: `<dir>/<pid>.jsonl` (0600) en un directorio 0700. El
// número de hechos y el tamaño viven en memoria (se leen del disco una vez al
// crear el spool): pending() y append() no releen el fichero. Si no cabe o no
// se puede escribir, se marca `<pid>.gap` (si se puede) y el hecho se descarta
// sin lanzar. removeFirst escribe el resto en `<pid>.jsonl.tmp` y lo renombra
// encima: un corte a mitad deja el fichero viejo entero (reenvío idempotente
// por event_id), nunca uno truncado.
export class FsFactSpool implements FactSpool {
  readonly #file: string; readonly #gap: string; readonly #maxBytes: number;
  #count: number; #bytes: number;

  constructor(dir: string, pid: number, maxBytes = 10 * 1024 * 1024) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#file = join(dir, `${pid}.jsonl`); this.#gap = join(dir, `${pid}.gap`); this.#maxBytes = maxBytes;
    this.#count = this.#read().length;
    this.#bytes = existsSync(this.#file) ? statSync(this.#file).size : 0;
  }

  append(fact: FactDto): void {
    const line = `${JSON.stringify(fact)}\n`; const size = Buffer.byteLength(line);
    if (this.#bytes + size > this.#maxBytes) { this.#markGap(); return; }
    try { appendFileSync(this.#file, line, { mode: 0o600 }); } catch { this.#markGap(); return; }
    this.#count++; this.#bytes += size;
  }

  readAll(): FactDto[] { return this.#count === 0 ? [] : this.#read(); }

  removeFirst(n: number): void {
    const rest = this.#read().slice(n);
    if (rest.length === 0) { rmSync(this.#file, { force: true }); this.#count = 0; this.#bytes = 0; return; }
    const text = rest.map((f) => `${JSON.stringify(f)}\n`).join("");
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, this.#file);
    this.#count = rest.length; this.#bytes = Buffer.byteLength(text);
  }

  pending(): number { return this.#count; }

  #read(): FactDto[] {
    if (!existsSync(this.#file)) return [];
    return readFileSync(this.#file, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as FactDto]; } catch { return []; } });
  }

  #markGap(): void { try { closeSync(openSync(this.#gap, "a", 0o600)); } catch { /* ni el marcador cabe */ } }
}
