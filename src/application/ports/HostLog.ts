// Log del host (JSON por líneas). Los campos son metadatos: nunca texto de prompts,
// argumentos o salidas, ni cabeceras OTLP. `trace_id` y `span_id`, si vienen como texto,
// van a la raíz de la línea.
export interface HostLog {
  info(message: string, fields?: Record<string, string | number | boolean | null>): void;
  warn(message: string, fields?: Record<string, string | number | boolean | null>): void;
  error(message: string, fields?: Record<string, string | number | boolean | null>): void;
}
