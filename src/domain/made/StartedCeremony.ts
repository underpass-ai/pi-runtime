import { DomainError } from "../shared/DomainError.ts";
import type { SessionId } from "../events/SessionId.ts";
import type { Timestamp } from "../events/Timestamp.ts";
import { CeremonyEndReason } from "./CeremonyEndReason.ts";
import { CeremonyId } from "./CeremonyId.ts";
import type { CeremonySnapshot } from "./CeremonySnapshot.ts";
import { MadeScope } from "./MadeScope.ts";

// F3: una instancia de ceremonia que arrancó esta sesión con una confirmación humana. Mientras
// no llegue a un terminal, las escrituras de ejecución sobre ella se conceden solas con un grant
// de alcance `ceremony` a esa instancia. Lleva sólo identidad: id, definición y versión.
export class StartedCeremony {
  readonly session: SessionId; readonly ceremony: CeremonyId; readonly definition: string | null; readonly version: string | null;
  readonly startedAt: Timestamp; readonly end: CeremonyEndReason | null;
  private constructor(session: SessionId, ceremony: CeremonyId, definition: string | null, version: string | null, startedAt: Timestamp, end: CeremonyEndReason | null) {
    this.session = session; this.ceremony = ceremony; this.definition = definition; this.version = version; this.startedAt = startedAt; this.end = end;
  }

  static from(session: SessionId, snapshot: CeremonySnapshot, at: Timestamp): StartedCeremony {
    return new StartedCeremony(session, snapshot.ceremony, snapshot.definition, snapshot.version, at, null);
  }

  // Desde el payload de made.ceremony_started; startedAt es el occurredAt del hecho.
  static fromFact(session: SessionId, payload: unknown, at: Timestamp): StartedCeremony {
    if (typeof payload !== "object" || payload === null) throw DomainError.because("ceremony payload must be an object");
    const p = payload as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(v) ? v : null);
    return new StartedCeremony(session, CeremonyId.of(p.ceremonyId as string), text(p.definition), text(p.version), at, null);
  }

  ended(reason: CeremonyEndReason): StartedCeremony { return new StartedCeremony(this.session, this.ceremony, this.definition, this.version, this.startedAt, reason); }
  running(): boolean { return this.end === null; }
  // El alcance de MADE de esta instancia: el de los grants de ejecución.
  scope(): MadeScope { return MadeScope.ceremony(this.ceremony); }

  // Legible: `ceremony <id> (<definición> v<versión>)`.
  summary(): string {
    const def = this.definition === null ? "" : ` (${this.definition}${this.version === null ? "" : ` v${this.version}`})`;
    return `ceremony ${this.ceremony.value}${def}`;
  }

  // Payload de made.ceremony_started (F3), v1.
  toFactPayload(): Record<string, unknown> { return { ceremonyId: this.ceremony.value, definition: this.definition, version: this.version }; }
}
