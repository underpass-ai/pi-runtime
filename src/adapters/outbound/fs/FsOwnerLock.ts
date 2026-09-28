import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OwnerLock } from "../../../application/ports/OwnerLock.ts";
import type { OwnerLockAcquisition } from "../../../application/ports/OwnerLockAcquisition.ts";

export class FsOwnerLock implements OwnerLock {
  readonly #file: string;
  constructor(dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); this.#file = join(dir, "host.lock"); }

  acquire(): OwnerLockAcquisition {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(this.#file, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
        return { owned: true, release: () => rmSync(this.#file, { force: true }) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const pid = this.#ownerPid();
        if (pid > 0 && this.#alive(pid)) return { owned: false, ownerPid: pid };
        rmSync(this.#file, { force: true });
      }
    }
    throw new Error(`could not acquire ${this.#file}`);
  }

  #ownerPid(): number { try { return Number(JSON.parse(readFileSync(this.#file, "utf8")).pid) || -1; } catch { return -1; } }
  #alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } }
}
