export class HostCallError extends Error {
  readonly kind: string; readonly code?: string | number;
  constructor(kind: string, message: string, code?: string | number) { super(message); this.name = "HostCallError"; this.kind = kind; this.code = code; }
}
