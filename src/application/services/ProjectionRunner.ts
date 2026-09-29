import { DomainError } from "../../domain/shared/DomainError.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { ProjectionState } from "./ProjectionState.ts";

const MAX_FAILURES = 3;

export class ProjectionRunner {
  readonly #events: EventStore; readonly #store: ProjectionStore; readonly #projections: Projection[]; readonly #batch: number;
  readonly #failures = new Map<string, number>();

  constructor(events: EventStore, store: ProjectionStore, projections: Projection[], batch = 500) {
    this.#events = events; this.#store = store; this.#projections = projections; this.#batch = batch;
  }

  projections(): Projection[] { return [...this.#projections]; }
  runOnce(): void { for (const p of this.#projections) this.#run(p); }

  rebuild(name: ProjectionName): void {
    const p = this.#projections.find((x) => x.name.equals(name));
    if (p === undefined) throw DomainError.because(`unknown projection ${name.value}`);
    this.#store.reset(p.name, p.version);
    this.#run(p);
  }

  #run(p: Projection): void {
    let cursor = this.#store.cursor(p.name);
    if (cursor === null || cursor.version !== p.version) { this.#store.reset(p.name, p.version); cursor = ProjectionCursor.of(p.version, GlobalPosition.START); }
    const state = new ProjectionState(this.#store.load(p.name));
    let position: GlobalPosition = cursor.position;
    for (;;) {
      const batch = this.#events.readAll(position, this.#batch);
      if (batch.length === 0) return;
      for (const e of batch) {
        try { p.apply(state, e); state.accept(); }
        catch (err) {
          state.discard();
          this.#commit(p, position, state);
          const key = `${p.name.value}@${e.position.value}`;
          const failures = (this.#failures.get(key) ?? 0) + 1;
          if (failures < MAX_FAILURES) { this.#failures.set(key, failures); return; }
          this.#failures.delete(key);
          this.#store.quarantine(p.name, e.position, (err as Error)?.message ?? String(err));
        }
        position = e.position;
      }
      this.#commit(p, position, state);
    }
  }

  #commit(p: Projection, position: GlobalPosition, state: ProjectionState): void {
    this.#store.commit(p.name, ProjectionCursor.of(p.version, position), state.changes());
    state.clearChanges();
  }
}
