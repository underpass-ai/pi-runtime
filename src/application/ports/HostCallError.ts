import type { ConfirmationRequestDto } from "../dto/ConfirmationRequestDto.ts";

// Error del puerto HostGateway: el host rechazó la llamada o el transporte
// falló. Bajo Pi cada fichero de extensión vive en su propio realm de jiti
// (moduleCache: false), así que quien lo reciba NUNCA debe usar
// `instanceof`: la clase que lanza el gateway no es la misma que ve el
// consumidor. `HostCallError.is` lo reconoce por su forma (name + kind).
// confirmation: sólo en la negativa `needs_confirmation` de MADE (S3a §3).
export class HostCallError extends Error {
  readonly kind: string; readonly code?: string | number; readonly confirmation?: ConfirmationRequestDto;
  constructor(kind: string, message: string, code?: string | number, confirmation?: ConfirmationRequestDto) {
    super(message); this.name = "HostCallError"; this.kind = kind; this.code = code; this.confirmation = confirmation;
  }

  static is(e: unknown): e is HostCallError {
    if (typeof e !== "object" || e === null) return false;
    const x = e as { name?: unknown; kind?: unknown; message?: unknown };
    return x.name === "HostCallError" && typeof x.kind === "string" && typeof x.message === "string";
  }
}
