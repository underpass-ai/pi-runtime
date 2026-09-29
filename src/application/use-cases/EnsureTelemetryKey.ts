import { TelemetryKey } from "../../domain/telemetry/TelemetryKey.ts";
import type { EntropySource } from "../ports/EntropySource.ts";
import type { TelemetryKeyRepository } from "../ports/TelemetryKeyRepository.ts";

// La clave de telemetría se crea una vez por instalación (32 bytes de entropía) y
// nunca rota: si otro proceso la creó a la vez, se usa la suya.
export class EnsureTelemetryKey {
  readonly #repo: TelemetryKeyRepository; readonly #entropy: EntropySource;
  constructor(repo: TelemetryKeyRepository, entropy: EntropySource) { this.#repo = repo; this.#entropy = entropy; }

  execute(): TelemetryKey {
    const existing = this.#repo.load();
    if (existing !== null) return existing;
    const key = TelemetryKey.fromBytes(this.#entropy.bytes(32));
    try { this.#repo.create(key); return key; }
    catch (e) {
      if ((e as { code?: unknown }).code === "EEXIST") { const winner = this.#repo.load(); if (winner !== null) return winner; }
      throw e;
    }
  }
}
