import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { FactDto } from "../../../application/dto/FactDto.ts";
import type { OrphanSpoolSource } from "../../../application/ports/OrphanSpoolSource.ts";

const SPOOL = /^(\d+)\.jsonl$/;
const TMP = /^(\d+)\.jsonl\.tmp$/;
const CLAIMED = /^\d+\.jsonl\.draining$/;

// ESRCH: no existe; EPERM: existe pero es de otro usuario (vivo).
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
};

// Reclama `<pid>.jsonl` de pids muertos con un rename atómico a
// `<pid>.jsonl.draining`: el proceso que lo escribía ya no existe y el host es
// el único adoptante (lock de propietario), así que nadie más lo toca. Los
// `.draining` que un host muerto dejó a medias se recogen igual. Los
// marcadores `.gap` se conservan: el hueco sigue siendo visible en doctor.
export class FsOrphanSpoolSource implements OrphanSpoolSource {
  readonly #dir: string; readonly #alive: (pid: number) => boolean;
  constructor(dir: string, isAlive: (pid: number) => boolean = alive) { this.#dir = dir; this.#alive = isAlive; }

  claim(): string[] {
    if (!existsSync(this.#dir)) return [];
    for (const name of readdirSync(this.#dir)) {
      const spool = SPOOL.exec(name); const tmp = TMP.exec(name);
      const pid = Number((spool ?? tmp)?.[1]);
      if (!Number.isInteger(pid) || this.#alive(pid)) continue;
      try {
        if (spool) renameSync(join(this.#dir, name), join(this.#dir, `${name}.draining`));
        else rmSync(join(this.#dir, name), { force: true }); // el .jsonl de al lado sigue entero
      } catch { /* desapareció entre el listado y el rename */ }
    }
    return readdirSync(this.#dir).filter((n) => CLAIMED.test(n)).sort();
  }

  read(claim: string): { facts: FactDto[]; unreadable: number } {
    const file = join(this.#dir, claim);
    if (!existsSync(file)) return { facts: [], unreadable: 0 };
    const facts: FactDto[] = []; let unreadable = 0;
    for (const l of readFileSync(file, "utf8").split("\n").filter((x) => x.trim())) {
      try { facts.push(JSON.parse(l) as FactDto); } catch { unreadable++; }
    }
    return { facts, unreadable };
  }

  release(claim: string): void { rmSync(join(this.#dir, claim), { force: true }); }
}
