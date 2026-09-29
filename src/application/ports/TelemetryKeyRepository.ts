import type { TelemetryKey } from "../../domain/telemetry/TelemetryKey.ts";

// Clave de telemetría de la instalación. `create` no pisa una existente
// (TelemetryKeyError con code EEXIST); los errores nunca llevan ruta ni valor.
export interface TelemetryKeyRepository {
  load(): TelemetryKey | null;
  create(key: TelemetryKey): void;
}
