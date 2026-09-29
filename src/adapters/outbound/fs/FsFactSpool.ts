import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FactDto } from "../../../application/dto/FactDto.ts";
import type { FactSpool } from "../../../application/ports/FactSpool.ts";

export class FsFactSpool implements FactSpool {
  readonly #file: string; readonly #gap: string; readonly #maxBytes: number;
  constructor(dir: string, pid: number, maxBytes = 10 * 1024 * 1024) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#file = join(dir, `${pid}.jsonl`); this.#gap = join(dir, `${pid}.gap`); this.#maxBytes = maxBytes;
  }

  append(fact: FactDto): void {
    const line = `${JSON.stringify(fact)}\n`;
    const size = existsSync(this.#file) ? statSync(this.#file).size : 0;
    if (size + Buffer.byteLength(line) > this.#maxBytes) { closeSync(openSync(this.#gap, "a", 0o600)); return; }
    appendFileSync(this.#file, line, { mode: 0o600 });
  }

  readAll(): FactDto[] {
    if (!existsSync(this.#file)) return [];
    return readFileSync(this.#file, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as FactDto]; } catch { return []; } });
  }

  removeFirst(n: number): void {
    const rest = this.readAll().slice(n);
    if (rest.length === 0) { rmSync(this.#file, { force: true }); return; }
    writeFileSync(this.#file, rest.map((f) => `${JSON.stringify(f)}\n`).join(""), { mode: 0o600 });
  }

  pending(): number { return this.readAll().length; }
}
