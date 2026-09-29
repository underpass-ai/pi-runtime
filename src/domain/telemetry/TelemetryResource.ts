import { OtelKeyValueList } from "./OtelKeyValueList.ts";
import { SpanAttributes } from "./SpanAttributes.ts";
import type { TelemetryInstanceId } from "./TelemetryInstanceId.ts";

const KEY = /^[a-z][a-z0-9_.]*$/;
// Claves que identificarían la máquina, la persona o el proceso (también el pod, la cuenta
// o la instancia en la nube): nunca salen, aunque vengan en OTEL_RESOURCE_ATTRIBUTES.
const FORBIDDEN = /^(?:(?:host|os|process|user|enduser|device|container|k8s|cloud|faas)\.|service\.instance\.id$)/;

// Recurso OTLP: service.name=pi-runtime, service.version, y pi_runtime.project y
// service.instance.id con el id de instancia (HMAC con la clave de la instalación, nunca
// la ruta ni su hash sin sal). Respeta OTEL_RESOURCE_ATTRIBUTES salvo claves prohibidas
// (incluido un service.instance.id del usuario), claves no válidas y valores con
// separadores de ruta; los atributos propios no se pisan.
export class TelemetryResource {
  readonly #attributes: SpanAttributes;
  private constructor(attributes: SpanAttributes) { this.#attributes = attributes; }

  static of(version: string, instance: TelemetryInstanceId, extra: OtelKeyValueList = OtelKeyValueList.EMPTY): TelemetryResource {
    const values: Record<string, string> = {};
    for (const [k, v] of extra.entries()) if (KEY.test(k) && !FORBIDDEN.test(k) && !/[\\/]/.test(v)) values[k] = v;
    return new TelemetryResource(SpanAttributes.of({ ...values, "service.name": "pi-runtime", "service.version": version, "pi_runtime.project": instance.value, "service.instance.id": instance.value }));
  }

  attributes(): SpanAttributes { return this.#attributes; }
}
