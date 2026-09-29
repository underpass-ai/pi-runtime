import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { ProjectionState } from "./ProjectionState.ts";

type Stream<T> = { lastMs: number; windows: T[] };

const ABANDONED_AFTER_MS = 24 * 3_600_000;
const MAX_OPEN = 32;

// Ventanas de decisión de L1 (spec §3), compartidas por tool_bandit y learning_eval. La
// ventana de un tools.selected va desde su occurredAt hasta el del siguiente de la sesión,
// o hasta el cierre o la reapertura posteriores (por occurredAt), o el abandono (24 h sin
// hechos de la sesión, medido con recordedAt de cualquier hecho, como en O1). El host registra tools.selected en el acto,
// pero los hechos de Pi llegan por su propia cola y pueden registrarse después de la
// decisión siguiente: por eso un hecho de Pi se atribuye por su occurredAt a la última
// decisión anterior a él, y una ventana sólo se cierra cuando llega un hecho de Pi posterior
// al inicio de la siguiente (Pi entrega sus hechos en orden). Estado en `key`, como JSON.
export class SelectionWindows<T extends { atMs: number }> {
  readonly #key: string; readonly #close: (state: ProjectionState, window: T) => void; readonly #forget: (state: ProjectionState, stream: string) => void;
  // close: lo que la proyección hace al cerrarse una ventana (p. ej. los 0 suaves). forget: lo
  // que hace cuando una sesión se queda sin ventanas abiertas (cierre, reapertura o abandono),
  // para que su estado por sesión no crezca sin límite.
  constructor(key: string, close: (state: ProjectionState, window: T) => void, forget: (state: ProjectionState, stream: string) => void = () => {}) {
    this.#key = key; this.#close = close; this.#forget = forget;
  }

  // opened: la ventana que abre este hecho si es un tools.selected válido. attribute recibe
  // la ventana a la que pertenece un hecho de Pi; lo que cambie en ella se guarda.
  visit(state: ProjectionState, e: StoredEvent, opened: T | null, attribute: (window: T) => void = () => {}): void {
    const r = e.record; const now = r.recordedAt.epochMs();
    const all = state.get<Record<string, Stream<T>>>(this.#key) ?? {};
    let changed = false;
    for (const [stream, s] of Object.entries(all)) {
      if (now < s.lastMs + ABANDONED_AFTER_MS) continue;
      for (const w of s.windows) this.#close(state, w);
      delete all[stream]; changed = true; this.#forget(state, stream);
    }
    if (r.stream.isSession()) {
      const stream = r.stream.value; const at = r.occurredAt.epochMs();
      const s = all[stream] ?? { lastMs: now, windows: [] };
      switch (r.type.value) {
        case "tools.selected":
          if (opened !== null) {
            const i = s.windows.findIndex((w) => w.atMs > opened.atMs);
            s.windows.splice(i < 0 ? s.windows.length : i, 0, opened);
            while (s.windows.length > MAX_OPEN) this.#close(state, s.windows.shift()!);
          }
          break;
        // Por occurredAt: un session.opened que llega por la cola de Pi después del primer
        // tools.selected no cierra esa decisión; sólo las que empezaron antes o a la vez.
        case "session.opened": case "session.closed":
          while (s.windows.length > 0 && s.windows[0].atMs <= at) this.#close(state, s.windows.shift()!);
          break;
        default:
          while (s.windows.length > 1 && s.windows[1].atMs <= at) this.#close(state, s.windows.shift()!);
          if (s.windows.length > 0 && s.windows[0].atMs <= at) attribute(s.windows[0]);
      }
      if (s.windows.length > 0 || all[stream] !== undefined) {
        s.lastMs = now; changed = true;
        if (s.windows.length > 0) all[stream] = s; else { delete all[stream]; this.#forget(state, stream); }
      }
    }
    if (changed) state.set(this.#key, all);
  }
}
