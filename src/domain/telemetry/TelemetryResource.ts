import type { ProjectId } from "../project/ProjectId.ts";
import { OtelKeyValueList } from "./OtelKeyValueList.ts";
import { SpanAttributes } from "./SpanAttributes.ts";

const KEY = /^[a-z][a-z0-9_.]*$/;
// Claves que identificarían la máquina, la persona o el proceso: nunca salen, aunque vengan en OTEL_RESOURCE_ATTRIBUTES.
const FORBIDDEN = /^(host|os|process|user|enduser|device|container)\./;

// Recurso OTLP: service.name=pi-runtime, service.version y pi_runtime.project (el id con
// hash, nunca la ruta). Respeta OTEL_RESOURCE_ATTRIBUTES salvo claves prohibidas, claves
// no válidas y valores con separadores de ruta; los tres atributos propios no se pisan.
export class TelemetryResource {
  readonly #attributes: SpanAttributes;
  private constructor(attributes: SpanAttributes) { this.#attributes = attributes; }

  static of(version: string, project: ProjectId, extra: OtelKeyValueList = OtelKeyValueList.EMPTY): TelemetryResource {
    const values: Record<string, string> = {};
    for (const [k, v] of extra.entries()) if (KEY.test(k) && !FORBIDDEN.test(k) && !/[\\/]/.test(v)) values[k] = v;
    return new TelemetryResource(SpanAttributes.of({ ...values, "service.name": "pi-runtime", "service.version": version, "pi_runtime.project": project.value }));
  }

  attributes(): SpanAttributes { return this.#attributes; }
}
