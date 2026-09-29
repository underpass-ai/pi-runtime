import { DomainError } from "../shared/DomainError.ts";
import { OtlpEndpoint } from "./OtlpEndpoint.ts";
import { OtlpHeaders } from "./OtlpHeaders.ts";
import { OtlpSettings } from "./OtlpSettings.ts";

type State = "disabled" | "enabled" | "invalid";

// La exportación sólo se activa con OTEL_EXPORTER_OTLP_ENDPOINT. Una configuración
// inválida desactiva la exportación y se explica (en doctor y una vez en host.log) con
// un mensaje propio que nunca repite el endpoint ni las cabeceras.
export class OtlpConfiguration {
  readonly state: State; readonly settings: OtlpSettings | null; readonly problem: string | null;
  private constructor(state: State, settings: OtlpSettings | null, problem: string | null) { this.state = state; this.settings = settings; this.problem = problem; }
  static readonly DISABLED = new OtlpConfiguration("disabled", null, null);

  static fromEnvironment(v: { endpoint?: string; headers?: string; timeout?: string }): OtlpConfiguration {
    if (v.endpoint === undefined || v.endpoint.trim() === "") return OtlpConfiguration.DISABLED;
    try {
      const headers = v.headers === undefined || v.headers.trim() === "" ? OtlpHeaders.NONE : OtlpHeaders.parse(v.headers);
      return new OtlpConfiguration("enabled", OtlpSettings.of(OtlpEndpoint.of(v.endpoint), headers, OtlpSettings.timeout(v.timeout)), null);
    } catch (e) {
      return new OtlpConfiguration("invalid", null, e instanceof DomainError ? e.message : "invalid OTLP configuration");
    }
  }
}
