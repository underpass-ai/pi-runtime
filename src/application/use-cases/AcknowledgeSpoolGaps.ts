import type { SpoolGapMarkers } from "../ports/SpoolGapMarkers.ts";

// Un hueco del spool no se puede reparar (los hechos se perdieron y nunca se
// inventan): el operador lo revisa y lo reconoce, y doctor deja de fallar por él.
export class AcknowledgeSpoolGaps {
  readonly #markers: SpoolGapMarkers;
  constructor(markers: SpoolGapMarkers) { this.#markers = markers; }

  execute(): string[] {
    const markers = this.#markers.list();
    for (const m of markers) this.#markers.remove(m);
    return markers;
  }
}
