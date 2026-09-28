import type { BinaryName } from "../../domain/distribution/BinaryName.ts";
import type { PinSet } from "../../domain/distribution/PinSet.ts";
import type { Target } from "../../domain/distribution/Target.ts";
import type { BinaryInstallation } from "../ports/BinaryInstallation.ts";
import type { FileDigester } from "../ports/FileDigester.ts";

// Verificación de sólo lectura de los binarios fijados: la usa `doctor`, que
// no debe descargar ni reinstalar nada. `setup` y `update` siguen usando
// InstallPinnedBinaries.
export class VerifyPinnedBinaries {
  readonly #pins: PinSet; readonly #target: Target; readonly #digester: FileDigester; readonly #installation: BinaryInstallation;

  constructor(pins: PinSet, target: Target, digester: FileDigester, installation: BinaryInstallation) {
    this.#pins = pins; this.#target = target; this.#digester = digester; this.#installation = installation;
  }

  async execute(): Promise<{ name: BinaryName; path: string; status: "verified" | "missing" | "mismatch" }[]> {
    const results: { name: BinaryName; path: string; status: "verified" | "missing" | "mismatch" }[] = [];
    for (const pin of this.#pins.binaries()) {
      const path = this.#installation.pathOf(pin);
      if (!this.#installation.exists(pin)) { results.push({ name: pin.name, path, status: "missing" }); continue; }
      const matches = (await this.#digester.sha256(path)).equals(pin.digestFor(this.#target));
      results.push({ name: pin.name, path, status: matches ? "verified" : "mismatch" });
    }
    return results;
  }
}
