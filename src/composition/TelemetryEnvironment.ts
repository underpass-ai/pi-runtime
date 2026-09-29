import type { Project } from "../domain/project/Project.ts";
import { OtelKeyValueList } from "../domain/telemetry/OtelKeyValueList.ts";
import { OtlpConfiguration } from "../domain/telemetry/OtlpConfiguration.ts";
import { TelemetryResource } from "../domain/telemetry/TelemetryResource.ts";
import { PackageInfo } from "./PackageInfo.ts";

type Env = Record<string, string | undefined>;

// Lectura de las variables OTEL_* estándar; la validación la hace el dominio.
export class TelemetryEnvironment {
  private constructor() {}

  static configuration(env: Env): OtlpConfiguration {
    return OtlpConfiguration.fromEnvironment({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: env.OTEL_EXPORTER_OTLP_HEADERS, timeout: env.OTEL_EXPORTER_OTLP_TIMEOUT });
  }

  // Una OTEL_RESOURCE_ATTRIBUTES mal formada se ignora entera: el recurso propio sigue saliendo.
  static resource(env: Env, project: Project): TelemetryResource {
    let extra = OtelKeyValueList.EMPTY;
    try { extra = OtelKeyValueList.parse(env.OTEL_RESOURCE_ATTRIBUTES ?? ""); } catch { extra = OtelKeyValueList.EMPTY; }
    return TelemetryResource.of(PackageInfo.version(), project.id, extra);
  }
}
