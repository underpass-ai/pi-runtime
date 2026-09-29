import { DomainError } from "../shared/DomainError.ts";
import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { Timestamp } from "../events/Timestamp.ts";

// Inicio del acumulado de las métricas (startTimeUnixNano de OTLP) y la versión de
// `telemetry_metrics` con la que se fijó: otra versión implica otro acumulado.
export class TelemetryEpoch {
  readonly start: Timestamp; readonly projectionVersion: number;
  private constructor(start: Timestamp, projectionVersion: number) { this.start = start; this.projectionVersion = projectionVersion; }

  static of(start: Timestamp, projectionVersion: number): TelemetryEpoch {
    if (!Number.isInteger(projectionVersion) || projectionVersion < 1) throw DomainError.because(`invalid projection version ${projectionVersion}`);
    return new TelemetryEpoch(start, projectionVersion);
  }

  // Tolerante: un valor ilegible cuenta como ausente (se fijará uno nuevo).
  static parse(text: string): TelemetryEpoch | null {
    try {
      const o = JSON.parse(text) as { start?: unknown; projectionVersion?: unknown };
      return TelemetryEpoch.of(Timestamp.parse(o.start as string), o.projectionVersion as number);
    } catch { return null; }
  }

  get text(): string { return CanonicalJson.of({ start: this.start.value, projectionVersion: this.projectionVersion }).text; }
}
