import { ValueObject } from "../shared/ValueObject.ts";
import { DomainError } from "../shared/DomainError.ts";

const SESSION = ["session.opened", "session.closed", "phase.changed", "turn.completed", "tool.started", "tool.completed", "model.selected", "context.compacted", "tools.selected"];
const HOST = ["host.started", "host.stopped", "server.started", "server.exited", "learning.mode_changed"];
// Forma de cualquier tipo de hecho, conocido o de una versión futura: `familia.nombre`.
const WELL_FORMED = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31}){1,3}$/;

export class EventType extends ValueObject<string> {
  readonly #known: boolean;
  private constructor(v: string, known: boolean) { super(v); this.#known = known; }

  // Un tipo que esta versión sabe registrar. Sólo éstos entran en hechos nuevos.
  static of(raw: string): EventType {
    if (typeof raw !== "string" || (!SESSION.includes(raw) && !HOST.includes(raw))) throw DomainError.because(`unknown event type "${raw}"`);
    return new EventType(raw, true);
  }

  // Lectores del log (S3a §4): un tipo que esta versión no conoce, pero bien formado, se
  // conserva opaco para que su registro se lea, se verifique y se exporte igual.
  static stored(raw: string): EventType {
    if (typeof raw === "string" && (SESSION.includes(raw) || HOST.includes(raw))) return new EventType(raw, true);
    if (typeof raw !== "string" || !WELL_FORMED.test(raw)) throw DomainError.because(`malformed event type "${raw}"`);
    return new EventType(raw, false);
  }

  known(): boolean { return this.#known; }
  belongsToSessions(): boolean { return SESSION.includes(this.value); }
}
