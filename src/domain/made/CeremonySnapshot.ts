import { CeremonyEndReason } from "./CeremonyEndReason.ts";
import { CeremonyId } from "./CeremonyId.ts";

// Lo que el host lee de una instancia que MADE devuelve (start, claim, complete, transición,
// get_ceremony_instance): su id, su definición y si ya llegó a un terminal (`lifecycle: ended`,
// sea por completarse, cancelarse o fallar). Sólo identidad y estado; nunca contexto ni salidas.
export class CeremonySnapshot {
  readonly ceremony: CeremonyId; readonly definition: string | null; readonly version: string | null; readonly end: CeremonyEndReason | null;
  private constructor(ceremony: CeremonyId, definition: string | null, version: string | null, end: CeremonyEndReason | null) {
    this.ceremony = ceremony; this.definition = definition; this.version = version; this.end = end;
  }

  // null si el resultado no es una instancia de ceremonia.
  static read(structured: unknown): CeremonySnapshot | null {
    if (typeof structured !== "object" || structured === null || Array.isArray(structured)) return null;
    const o = structured as Record<string, unknown>;
    const ceremony = CeremonyId.maybe(o.ceremony_id);
    if (ceremony === null || typeof o.lifecycle !== "string") return null;
    const name = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(v) ? v : null);
    return new CeremonySnapshot(ceremony, name(o.definition_name), name(o.definition_version), o.lifecycle === "ended" ? CeremonyEndReason.of(o.end_reason) : null);
  }

  ended(): boolean { return this.end !== null; }
}
