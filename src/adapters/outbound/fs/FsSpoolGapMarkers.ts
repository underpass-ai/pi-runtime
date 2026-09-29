import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SpoolGapMarkers } from "../../../application/ports/SpoolGapMarkers.ts";

const GAP = /^\d+\.gap$/;

// Nunca crea el directorio del spool; sólo borra ficheros `<pid>.gap` de él.
export class FsSpoolGapMarkers implements SpoolGapMarkers {
  readonly #dir: string;
  constructor(dir: string) { this.#dir = dir; }

  list(): string[] {
    if (!existsSync(this.#dir)) return [];
    return readdirSync(this.#dir).filter((n) => GAP.test(n)).sort();
  }

  remove(marker: string): void {
    if (!GAP.test(marker)) throw new Error(`${marker} is not a spool gap marker`);
    rmSync(join(this.#dir, marker), { force: true });
  }
}
