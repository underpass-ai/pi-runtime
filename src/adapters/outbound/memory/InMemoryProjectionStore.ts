import type { ProjectionStore } from "../../../application/ports/ProjectionStore.ts";
import { GlobalPosition } from "../../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../../domain/events/ProjectionName.ts";

export class InMemoryProjectionStore implements ProjectionStore {
  readonly #cursors = new Map<string, ProjectionCursor>();
  readonly #state = new Map<string, Map<string, unknown>>();
  readonly #quarantine = new Map<string, Map<number, { position: GlobalPosition; reason: string }>>();

  cursor(name: ProjectionName): ProjectionCursor | null { return this.#cursors.get(name.value) ?? null; }
  load(name: ProjectionName): Map<string, unknown> { return new Map([...(this.#state.get(name.value) ?? new Map())].map(([k, v]) => [k, structuredClone(v)])); }
  snapshot(name: ProjectionName): { cursor: ProjectionCursor | null; state: Map<string, unknown> } { return { cursor: this.cursor(name), state: this.load(name) }; }

  commit(name: ProjectionName, expected: ProjectionCursor, next: ProjectionCursor, changes: Map<string, unknown>): boolean {
    const current = this.#cursors.get(name.value);
    if (current === undefined ? !expected.position.equals(GlobalPosition.START) : !current.equals(expected)) return false;
    const s = this.#state.get(name.value) ?? new Map<string, unknown>();
    for (const [k, v] of changes) { if (v === undefined) s.delete(k); else s.set(k, structuredClone(v)); }
    this.#state.set(name.value, s);
    this.#cursors.set(name.value, next);
    return true;
  }

  reset(name: ProjectionName, version: number): void {
    this.#state.delete(name.value); this.#quarantine.delete(name.value);
    this.#cursors.set(name.value, ProjectionCursor.of(version, GlobalPosition.START));
  }

  // Como el INSERT OR REPLACE de SQLite: una entrada por posición.
  quarantine(name: ProjectionName, position: GlobalPosition, reason: string): void {
    const q = this.#quarantine.get(name.value) ?? new Map<number, { position: GlobalPosition; reason: string }>();
    q.set(position.value, { position, reason });
    this.#quarantine.set(name.value, q);
  }
  quarantined(name: ProjectionName): { position: GlobalPosition; reason: string }[] {
    return [...(this.#quarantine.get(name.value)?.values() ?? [])].sort((a, b) => a.position.value - b.position.value);
  }
}
