import type { EventStore } from "../application/ports/EventStore.ts";

// Resuelve el almacén real en el primer uso. Así `events import` valida el bundle entero antes de abrir (y crear) el log.
export class LazyEventStore implements EventStore {
  readonly #resolve: () => EventStore;
  constructor(resolve: () => EventStore) { this.#resolve = resolve; }
  append(...a: Parameters<EventStore["append"]>) { return this.#resolve().append(...a); }
  importSealed(...a: Parameters<EventStore["importSealed"]>) { return this.#resolve().importSealed(...a); }
  head(...a: Parameters<EventStore["head"]>) { return this.#resolve().head(...a); }
  find(...a: Parameters<EventStore["find"]>) { return this.#resolve().find(...a); }
  readStream(...a: Parameters<EventStore["readStream"]>) { return this.#resolve().readStream(...a); }
  readAll(...a: Parameters<EventStore["readAll"]>) { return this.#resolve().readAll(...a); }
  streams() { return this.#resolve().streams(); }
  lastPosition() { return this.#resolve().lastPosition(); }
}
