import type { ProjectionStore } from "../application/ports/ProjectionStore.ts";

// Resuelve el almacén real en el primer uso (ver LazyEventStore).
export class LazyProjectionStore implements ProjectionStore {
  readonly #resolve: () => ProjectionStore;
  constructor(resolve: () => ProjectionStore) { this.#resolve = resolve; }
  cursor(...a: Parameters<ProjectionStore["cursor"]>) { return this.#resolve().cursor(...a); }
  load(...a: Parameters<ProjectionStore["load"]>) { return this.#resolve().load(...a); }
  snapshot(...a: Parameters<ProjectionStore["snapshot"]>) { return this.#resolve().snapshot(...a); }
  commit(...a: Parameters<ProjectionStore["commit"]>) { return this.#resolve().commit(...a); }
  reset(...a: Parameters<ProjectionStore["reset"]>) { return this.#resolve().reset(...a); }
  quarantine(...a: Parameters<ProjectionStore["quarantine"]>) { return this.#resolve().quarantine(...a); }
  quarantined(...a: Parameters<ProjectionStore["quarantined"]>) { return this.#resolve().quarantined(...a); }
}
