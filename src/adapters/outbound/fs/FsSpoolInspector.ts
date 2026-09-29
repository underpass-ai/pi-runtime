import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SpoolInspector } from "../../../application/ports/SpoolInspector.ts";

// Sólo lee: nunca crea el directorio del spool (doctor es de sólo lectura).
export class FsSpoolInspector implements SpoolInspector {
  readonly #dir: string;
  constructor(dir: string) { this.#dir = dir; }
  inspect(): { pendingFiles: number; gaps: number } {
    if (!existsSync(this.#dir)) return { pendingFiles: 0, gaps: 0 };
    const names = readdirSync(this.#dir);
    return {
      pendingFiles: names.filter((n) => (n.endsWith(".jsonl") || n.endsWith(".jsonl.draining")) && statSync(join(this.#dir, n)).size > 0).length,
      gaps: names.filter((n) => n.endsWith(".gap")).length,
    };
  }
}
