// Error del puerto HostGateway: el host rechazó la llamada o el transporte
// falló. Bajo Pi cada fichero de extensión vive en su propio realm de jiti
// (moduleCache: false), así que quien lo reciba NUNCA debe usar
// `instanceof`: la clase que lanza el gateway no es la misma que ve el
// consumidor. `HostCallError.is` lo reconoce por su forma (name + kind).
export class HostCallError extends Error {
  readonly kind: string; readonly code?: string | number;
  constructor(kind: string, message: string, code?: string | number) { super(message); this.name = "HostCallError"; this.kind = kind; this.code = code; }

  static is(e: unknown): e is HostCallError {
    if (typeof e !== "object" || e === null) return false;
    const x = e as { name?: unknown; kind?: unknown; message?: unknown };
    return x.name === "HostCallError" && typeof x.kind === "string" && typeof x.message === "string";
  }
}
