import { createHmac } from "node:crypto";
import type { ProjectId } from "../project/ProjectId.ts";
import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { TelemetryKey } from "./TelemetryKey.ts";

// Identidad del proyecto en la telemetría: HMAC-SHA256(clave de la instalación, ProjectId),
// 16 hex. Sale como pi_runtime.project y service.instance.id: distingue proyectos (series
// de Prometheus por instancia) sin que el hash sin sal de la ruta se pueda adivinar.
export class TelemetryInstanceId extends ValueObject<string> {
  private constructor(v: string) { super(v); }

  static of(raw: string): TelemetryInstanceId {
    if (typeof raw !== "string" || !/^[0-9a-f]{16}$/.test(raw)) throw DomainError.because("telemetry instance id must be 16 lowercase hex characters");
    return new TelemetryInstanceId(raw);
  }

  static derive(key: TelemetryKey, project: ProjectId): TelemetryInstanceId {
    const secret = Uint8Array.from(key.reveal().match(/../g)!, (h) => parseInt(h, 16));
    return new TelemetryInstanceId(createHmac("sha256", secret).update(project.value).digest("hex").slice(0, 16));
  }
}
