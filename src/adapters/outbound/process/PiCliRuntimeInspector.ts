import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PiRuntimeInspector } from "../../../application/ports/PiRuntimeInspector.ts";
import { SemVer } from "../../../domain/distribution/SemVer.ts";

export class PiCliRuntimeInspector implements PiRuntimeInspector {
  readonly #pi: string;
  constructor(pi = "pi") { this.#pi = pi; }
  async version(): Promise<SemVer | null> {
    try {
      const m = (await promisify(execFile)(this.#pi, ["--version"])).stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
      return m ? SemVer.of(m[0]) : null;
    } catch { return null; }
  }
}
