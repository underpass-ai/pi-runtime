import { DomainError } from "../shared/DomainError.ts";
import type { OtlpEndpoint } from "./OtlpEndpoint.ts";
import type { OtlpHeaders } from "./OtlpHeaders.ts";

const TIMEOUT = "OTEL_EXPORTER_OTLP_TIMEOUT must be an integer between 1 and 600000 (ms)";

export class OtlpSettings {
  static readonly DEFAULT_TIMEOUT_MS = 10_000;
  readonly endpoint: OtlpEndpoint; readonly headers: OtlpHeaders; readonly timeoutMs: number;
  private constructor(endpoint: OtlpEndpoint, headers: OtlpHeaders, timeoutMs: number) { this.endpoint = endpoint; this.headers = headers; this.timeoutMs = timeoutMs; }

  static of(endpoint: OtlpEndpoint, headers: OtlpHeaders, timeoutMs: number = OtlpSettings.DEFAULT_TIMEOUT_MS): OtlpSettings {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw DomainError.because(TIMEOUT);
    return new OtlpSettings(endpoint, headers, timeoutMs);
  }

  // OTEL_EXPORTER_OTLP_TIMEOUT en ms; vacío o ausente, el valor por defecto.
  static timeout(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "") return OtlpSettings.DEFAULT_TIMEOUT_MS;
    if (!/^\d+$/.test(raw.trim())) throw DomainError.because(TIMEOUT);
    return Number(raw.trim());
  }
}
