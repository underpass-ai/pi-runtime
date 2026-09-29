import type { TelemetryEpoch } from "../../domain/telemetry/TelemetryEpoch.ts";

// Dónde vive el inicio del acumulado (en SQLite, `meta.telemetry_start`): sobrevive a los reinicios del host.
export interface TelemetryEpochStore {
  read(): TelemetryEpoch | null;
  write(epoch: TelemetryEpoch): void;
}
