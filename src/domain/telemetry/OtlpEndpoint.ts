import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

// OTEL_EXPORTER_OTLP_ENDPOINT. https:// obligatorio salvo en localhost, 127.0.0.1 o [::1].
// Sin credenciales, query ni fragmento. Los errores nunca repiten la URL; `describe` es lo
// único que se muestra (doctor): ni host ni ruta.
export class OtlpEndpoint extends ValueObject<string> {
  private constructor(v: string) { super(v); }

  static of(raw: string): OtlpEndpoint {
    if (typeof raw !== "string") throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must be a string");
    let url: URL;
    try { url = new URL(raw.trim()); } catch { throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL"); }
    if (url.username !== "" || url.password !== "") throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must not embed credentials; use OTEL_EXPORTER_OTLP_HEADERS");
    if (url.search !== "" || url.hash !== "") throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must not have a query or fragment");
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL.has(url.hostname));
    if (!secure) throw DomainError.because("OTEL_EXPORTER_OTLP_ENDPOINT must use https:// outside localhost, 127.0.0.1 and [::1]");
    return new OtlpEndpoint(url.href.replace(/\/+$/, ""));
  }

  signalUrl(signal: "traces" | "metrics"): string { return `${this.value}/v1/${signal}`; }
  isLocal(): boolean { return LOCAL.has(new URL(this.value).hostname); }
  describe(): string { return this.isLocal() ? "localhost" : "https"; }
  // Si alguien lo interpola o serializa por descuido, tampoco sale el host.
  override toString(): string { return `OtlpEndpoint(${this.describe()})`; }
  toJSON(): string { return this.describe(); }
}
