import { DomainError } from "../../domain/shared/DomainError.ts";
import type { BinaryName } from "../../domain/distribution/BinaryName.ts";
import type { BinaryPin } from "../../domain/distribution/BinaryPin.ts";
import type { PinSet } from "../../domain/distribution/PinSet.ts";
import type { Target } from "../../domain/distribution/Target.ts";
import type { BinaryInstallation } from "../ports/BinaryInstallation.ts";
import type { FileDigester } from "../ports/FileDigester.ts";
import type { ReleaseDownloader } from "../ports/ReleaseDownloader.ts";

export class InstallPinnedBinaries {
  readonly #pins: PinSet; readonly #target: Target; readonly #downloader: ReleaseDownloader;
  readonly #digester: FileDigester; readonly #installation: BinaryInstallation;

  constructor(pins: PinSet, target: Target, downloader: ReleaseDownloader, digester: FileDigester, installation: BinaryInstallation) {
    this.#pins = pins; this.#target = target; this.#downloader = downloader; this.#digester = digester; this.#installation = installation;
  }

  async execute(): Promise<{ name: BinaryName; path: string; action: "verified" | "installed" }[]> {
    const results: { name: BinaryName; path: string; action: "verified" | "installed" }[] = [];
    for (const pin of this.#pins.binaries()) {
      const expected = pin.digestFor(this.#target);
      const path = this.#installation.pathOf(pin);
      if (this.#installation.exists(pin) && (await this.#digester.sha256(path)).equals(expected)) {
        results.push({ name: pin.name, path, action: "verified" });
        continue;
      }
      await this.#installFresh(pin);
      results.push({ name: pin.name, path, action: "installed" });
    }
    return results;
  }

  async #installFresh(pin: BinaryPin): Promise<void> {
    const staging = this.#installation.stagingPathOf(pin);
    try {
      await this.#downloader.download(pin.releaseUrl(this.#target), staging);
      const actual = await this.#digester.sha256(staging);
      if (!actual.equals(pin.digestFor(this.#target))) throw DomainError.because(`sha256 mismatch for ${pin.name}: ${actual}`);
      this.#installation.commit(pin);
    } catch (e) {
      this.#installation.discard(pin);
      throw e;
    }
  }
}
