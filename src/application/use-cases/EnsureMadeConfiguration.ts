import { MadeConfiguration } from "../../domain/made/MadeConfiguration.ts";
import type { StorePath } from "../../domain/made/StorePath.ts";
import type { EntropySource } from "../ports/EntropySource.ts";
import type { MadeConfigurationRepository } from "../ports/MadeConfigurationRepository.ts";

export class EnsureMadeConfiguration {
  readonly #repo: MadeConfigurationRepository; readonly #entropy: EntropySource;
  constructor(repo: MadeConfigurationRepository, entropy: EntropySource) { this.#repo = repo; this.#entropy = entropy; }
  execute(store: StorePath): { configuration: MadeConfiguration; created: boolean; location: string } {
    const location = this.#repo.locationOf(store);
    const existing = this.#repo.load(store);
    if (existing) return { configuration: existing, created: false, location };
    const configuration = MadeConfiguration.generateFor(store, this.#entropy.bytes(32));
    try {
      this.#repo.create(store, configuration);
    } catch (e) {
      if ((e as { code?: string }).code === "EEXIST") {
        const reloaded = this.#repo.load(store);
        if (reloaded) return { configuration: reloaded, created: false, location };
      }
      throw e;
    }
    return { configuration, created: true, location };
  }
}
