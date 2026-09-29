type Kind = "ok" | "rejected" | "retryable" | "stale";

// Resultado de un envío OTLP. `reason` es siempre un código corto (http 503, timeout,
// network ECONNREFUSED…): nunca el endpoint, cabeceras ni el cuerpo de la respuesta.
// `stale`: la pasada perdió el compare-and-set del cursor frente a otro escritor (un
// rebuild); no es éxito ni fallo, y la siguiente pasada parte de la instantánea nueva.
export class ExportResult {
  readonly kind: Kind; readonly reason: string;
  private constructor(kind: Kind, reason: string) { this.kind = kind; this.reason = reason; }

  static ok(): ExportResult { return new ExportResult("ok", "ok"); }
  static rejected(reason: string): ExportResult { return new ExportResult("rejected", reason); }
  static retryable(reason: string): ExportResult { return new ExportResult("retryable", reason); }
  static stale(): ExportResult { return new ExportResult("stale", "stale"); }

  // 2xx: aceptado; 429 y 5xx: reintento; cualquier otro código: el lote se descarta.
  static ofStatus(status: number): ExportResult {
    if (status >= 200 && status < 300) return ExportResult.ok();
    if (status === 429 || status >= 500) return ExportResult.retryable(`http ${status}`);
    return ExportResult.rejected(`http ${status}`);
  }
}
