import { DomainError } from "../../domain/shared/DomainError.ts";
import { GlobalPosition } from "../../domain/events/GlobalPosition.ts";
import { ProjectionCursor } from "../../domain/events/ProjectionCursor.ts";
import type { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { ProjectionState } from "./ProjectionState.ts";

const MAX_FAILURES = 3;
const MAX_STALE = 3;

// El runner del host y `underpass events rebuild` pueden escribir a la vez:
// cada pasada parte de una instantánea (cursor + estado) y hace commit con
// compare-and-set. Si otro escritor movió el cursor, la pasada se descarta
// entera y se repite desde la instantánea nueva (hasta MAX_STALE veces; si no,
// el siguiente disparo lo retoma).
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
    for (let attempt = 1; attempt <= MAX_STALE; attempt++) if (this.#pass(p)) return;
  }

  // false: el cursor cambió por debajo (commit rechazado); nada se escribió.
  #pass(p: Projection): boolean {
    const snap = this.#store.snapshot(p.name);
    let cursor = snap.cursor; let initial = snap.state;
    if (cursor === null || cursor.version !== p.version) {
      this.#store.reset(p.name, p.version);
      cursor = ProjectionCursor.of(p.version, GlobalPosition.START); initial = new Map();
    }
    const state = new ProjectionState(initial);
    let position: GlobalPosition = cursor.position;
    for (;;) {
      const batch = this.#events.readAll(position, this.#batch);
      if (batch.length === 0) return true;
      for (const e of batch) {
        try { p.apply(state, e); state.accept(); }
        catch (err) {
          state.discard();
          if (!this.#commit(p, cursor, position, state)) return false;
          cursor = ProjectionCursor.of(p.version, position);
          const key = `${p.name.value}@${e.position.value}`;
          const failures = (this.#failures.get(key) ?? 0) + 1;
          if (failures < MAX_FAILURES) { this.#failures.set(key, failures); return true; }
          this.#failures.delete(key);
          this.#store.quarantine(p.name, e.position, (err as Error)?.message ?? String(err));
        }
        position = e.position;
      }
      if (!this.#commit(p, cursor, position, state)) return false;
      cursor = ProjectionCursor.of(p.version, position);
    }
  }

  #commit(p: Projection, expected: ProjectionCursor, position: GlobalPosition, state: ProjectionState): boolean {
    if (!this.#store.commit(p.name, expected, ProjectionCursor.of(p.version, position), state.changes())) return false;
    state.clearChanges();
    return true;
  }
}
