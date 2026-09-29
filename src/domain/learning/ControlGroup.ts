import { createHash } from "node:crypto";
import type { EventId } from "../events/EventId.ts";

// Grupo de control de `active` (spec §4): el 10 % de las decisiones mantiene el conjunto
// completo. Determinista a partir del event_id de tools.selected: los primeros 32 bits de
// sha256("pi-runtime.control:" + id) como fracción de 2^32.
export class ControlGroup {
  static readonly SHARE = 0.1;
  private constructor() {}

  static contains(id: EventId): boolean {
    const head = createHash("sha256").update(`pi-runtime.control:${id.value}`).digest("hex").slice(0, 8);
    return parseInt(head, 16) / 2 ** 32 < ControlGroup.SHARE;
  }
}
