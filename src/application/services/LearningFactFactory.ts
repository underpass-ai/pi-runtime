import { Actor } from "../../domain/events/Actor.ts";
import { EventAbout } from "../../domain/events/EventAbout.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { Fact } from "../../domain/events/Fact.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import type { LearningMode } from "../../domain/learning/LearningMode.ts";
import type { SelectionSize } from "../../domain/learning/SelectionSize.ts";
import type { ToolSelection } from "../../domain/learning/ToolSelection.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import type { Clock } from "../ports/Clock.ts";

const SELECTED = EventType.of("tools.selected");
const MODE_CHANGED = EventType.of("learning.mode_changed");

// Hechos de L1 (spec §5). El id de tools.selected se fija ANTES de muestrear (`slot`):
// es la semilla del PRNG y del grupo de control, y el hecho se registra con ese mismo id.
export class LearningFactFactory {
  readonly #clock: Clock; readonly #origin: string; readonly #actor: Actor; #seq = 0;
  // origin: quién decide (`host:<pid>` en el host, `cli` en `underpass learning mode`).
  constructor(clock: Clock, origin: string, actor: Actor) { this.#clock = clock; this.#origin = origin; this.#actor = actor; }

  slot(session: SessionId): { id: EventId; at: Timestamp } {
    const at = this.#clock.now();
    const about = EventAbout.of(`select.${this.#origin.replace(/[^A-Za-z0-9._-]/g, "_")}.${at.epochMs()}.${this.#seq++}`);
    return { id: EventId.derive(StreamId.session(session), SELECTED, about), at };
  }

  toolsSelected(session: SessionId, slot: { id: EventId; at: Timestamp }, selection: ToolSelection): Fact {
    return Fact.of({ id: slot.id, stream: StreamId.session(session), type: SELECTED, typeVersion: TypeVersion.V1, occurredAt: slot.at, actor: this.#actor, payload: CanonicalJson.of(selection.toPayload()) });
  }

  modeChanged(from: LearningMode, to: LearningMode, k: SelectionSize): Fact {
    const at = this.#clock.now();
    const about = EventAbout.of(`mode.${this.#origin.replace(/[^A-Za-z0-9._-]/g, "_")}.${at.epochMs()}.${this.#seq++}`);
    return Fact.of({ id: EventId.derive(StreamId.HOST, MODE_CHANGED, about), stream: StreamId.HOST, type: MODE_CHANGED, typeVersion: TypeVersion.V1, occurredAt: at, actor: this.#actor,
      payload: CanonicalJson.of({ from: from.value, to: to.value, k: k.value }) });
  }
}
