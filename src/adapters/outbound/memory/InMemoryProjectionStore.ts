import type { ProjectionStore } from "../../../application/ports/ProjectionStore.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../../domain/events/ProjectionName.ts";

export class InMemoryProjectionStore implements ProjectionStore {
  readonly #cursors = new Map<string, ProjectionCursor>();
  readonly #state = new Map<string, Map<string, unknown>>();
  readonly #quarantine = new Map<string, { position: GlobalPosition; reason: string }[]>();

  cursor(name: ProjectionName): ProjectionCursor | null { return this.#cursors.get(name.value) ?? null; }
  load(name: ProjectionName): Map<string, unknown> { return new Map([...(this.#state.get(name.value) ?? new Map())].map(([k, v]) => [k, structuredClone(v)])); }
  commit(name: ProjectionName, cursor: ProjectionCursor, changes: Map<string, unknown>): void {
    const s = this.#state.get(name.value) ?? new Map<string, unknown>();
    for (const [k, v] of changes) s.set(k, structuredClone(v));
    this.#state.set(name.value, s);
    this.#cursors.set(name.value, cursor);
  }
  reset(name: ProjectionName, version: number): void {
    this.#state.delete(name.value); this.#quarantine.delete(name.value);
    this.#cursors.set(name.value, ProjectionCursor.of(version, GlobalPosition.START));
  }
  quarantine(name: ProjectionName, position: GlobalPosition, reason: string): void {
    this.#quarantine.set(name.value, [...(this.#quarantine.get(name.value) ?? []), { position, reason }]);
  }
  quarantined(name: ProjectionName): { position: GlobalPosition; reason: string }[] { return [...(this.#quarantine.get(name.value) ?? [])]; }
}
