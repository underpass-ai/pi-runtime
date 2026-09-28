import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KmpLifecycle } from "../../../application/ports/KmpLifecycle.ts";

export class KmpCliLifecycle implements KmpLifecycle {
  readonly #binary: string; readonly #engineDir: string; readonly #env: Record<string, string | undefined>;
  constructor(binary: string, engineDir: string, env: Record<string, string | undefined>) { this.#binary = binary; this.#engineDir = engineDir; this.#env = env; }
  async setup(): Promise<void> { await promisify(execFile)(this.#binary, ["setup", "--engine-dir", this.#engineDir], { env: { ...process.env, ...this.#env } }); }
  async doctor(): Promise<boolean> {
    try { await promisify(execFile)(this.#binary, ["doctor"], { env: { ...process.env, ...this.#env } }); return true; } catch { return false; }
  }
}
