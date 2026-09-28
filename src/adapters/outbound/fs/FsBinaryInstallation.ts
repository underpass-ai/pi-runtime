import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BinaryInstallation } from "../../../application/ports/BinaryInstallation.ts";
import type { BinaryPin } from "../../../domain/distribution/BinaryPin.ts";

export class FsBinaryInstallation implements BinaryInstallation {
  readonly #dir: string;
  // Construirla no toca el disco: `doctor` la usa sólo para leer. El
  // directorio se crea cuando de verdad se va a instalar (stagingPathOf).
  constructor(dir: string) { this.#dir = dir; }
  pathOf(pin: BinaryPin): string { return join(this.#dir, pin.installedFileName()); }
  stagingPathOf(pin: BinaryPin): string { mkdirSync(this.#dir, { recursive: true }); return join(this.#dir, `.${pin.installedFileName()}.partial`); }
  exists(pin: BinaryPin): boolean { return existsSync(this.pathOf(pin)); }
  commit(pin: BinaryPin): void { chmodSync(this.stagingPathOf(pin), 0o755); renameSync(this.stagingPathOf(pin), this.pathOf(pin)); }
  discard(pin: BinaryPin): void { rmSync(this.stagingPathOf(pin), { force: true }); }
}
