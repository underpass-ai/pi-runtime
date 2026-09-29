// Error del puerto TelemetryKeyRepository. Nunca lleva la ruta del fichero ni la clave:
// sólo el motivo. `code` es "EEXIST" cuando otro proceso creó la clave antes.
export class TelemetryKeyError extends Error {
  readonly code: string | null;
  private constructor(message: string, code: string | null) { super(message); this.name = "TelemetryKeyError"; this.code = code; }
  static because(message: string): TelemetryKeyError { return new TelemetryKeyError(message, null); }
  static exists(): TelemetryKeyError { return new TelemetryKeyError("telemetry key already exists", "EEXIST"); }
}
