import { LearningMode } from "../../domain/learning/LearningMode.ts";
import { SelectionSize } from "../../domain/learning/SelectionSize.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { LearningFactFactory } from "../services/LearningFactFactory.ts";
import type { RecordFact } from "./RecordFact.ts";

type Json = Record<string, unknown>;

// `underpass learning mode` (spec §4, §8): registra learning.mode_changed en el stream del
// host. `from` y el k vigente salen del último cambio registrado (shadow y 12 si no hay
// ninguno); sin --k se conserva el k vigente.
export class ChangeLearningMode {
  readonly #events: EventStore; readonly #record: RecordFact; readonly #facts: LearningFactFactory;
  constructor(events: EventStore, record: RecordFact, facts: LearningFactFactory) { this.#events = events; this.#record = record; this.#facts = facts; }

  execute(to: LearningMode, k: SelectionSize | null = null): { from: string; to: string; k: number } {
    const current = this.current();
    const next = k ?? current.k;
    this.#record.execute(this.#facts.modeChanged(current.mode, LearningMode.setting(to.value), next));
    return { from: current.mode.value, to: to.value, k: next.value };
  }

  current(): { mode: LearningMode; k: SelectionSize } {
    let mode = LearningMode.DEFAULT; let k = SelectionSize.DEFAULT;
    for (const r of this.#events.readStream(StreamId.HOST)) {
      if (r.type.value !== "learning.mode_changed") continue;
      const p = r.payload.toValue() as Json;
      try { mode = LearningMode.setting(p.to as string); } catch { /* payload inesperado: se ignora */ }
      try { k = SelectionSize.of(p.k as number); } catch { /* idem */ }
    }
    return { mode, k };
  }
}
