import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";

// Proyecciones que no han alcanzado el final del log. Un cursor ausente o de otra versión cuenta desde 0:
// el runner la reconstruirá entera.
export class ProjectionLag {
  readonly #events: EventStore; readonly #store: ProjectionStore; readonly #list: Projection[];
  constructor(events: EventStore, store: ProjectionStore, list: Projection[]) { this.#events = events; this.#store = store; this.#list = list; }

  execute(only?: ProjectionName): { projection: string; position: number; last: number }[] {
    const last = this.#events.lastPosition().value;
    return this.#list.filter((p) => only === undefined || p.name.equals(only)).map((p) => {
      const c = this.#store.cursor(p.name);
      return { projection: p.name.value, position: c === null || c.version !== p.version ? 0 : c.position.value, last };
    }).filter((x) => x.position < x.last);
  }
}
