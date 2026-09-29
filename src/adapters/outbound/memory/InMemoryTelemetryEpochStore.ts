import type { TelemetryEpochStore } from "../../../application/ports/TelemetryEpochStore.ts";
import type { TelemetryEpoch } from "../../../domain/telemetry/TelemetryEpoch.ts";

export class InMemoryTelemetryEpochStore implements TelemetryEpochStore {
  #epoch: TelemetryEpoch | null = null;
  read(): TelemetryEpoch | null { return this.#epoch; }
  write(epoch: TelemetryEpoch): void { this.#epoch = epoch; }
}
