import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PiPackageManager } from "../../../application/ports/PiPackageManager.ts";

export class PiCliPackageManager implements PiPackageManager {
  readonly #pi: string;
  constructor(pi = "pi") { this.#pi = pi; }
  async install(packageDir: string): Promise<void> { await promisify(execFile)(this.#pi, ["install", packageDir]); }
  async isRegistered(packageName: string): Promise<boolean> {
    try { return (await promisify(execFile)(this.#pi, ["list"])).stdout.includes(packageName); } catch { return false; }
  }
}
