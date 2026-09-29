import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";

// Estado de una proyección durante una pasada. set valida el valor como JSON
// canónico: un valor que no es JSON (BigInt, NaN, Date, Map…) falla dentro de
// apply, y así toma el camino de reintento y cuarentena en vez de romper el
// commit. Se guarda la forma JSON, igual que la que devolverá SQLite.
// delete borra una clave: en changes() viaja como undefined, que el ProjectionStore interpreta
// como borrado (así el estado de una proyección puede estar acotado).
export class ProjectionState {
  readonly #values: Map<string, unknown>;
  readonly #pending = new Map<string, unknown>();
  readonly #changes = new Map<string, unknown>();

  constructor(initial: Map<string, unknown>) { this.#values = new Map(initial); }

  get<T>(key: string): T | undefined {
    const v = this.#pending.has(key) ? this.#pending.get(key) : this.#values.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  set(key: string, value: unknown): void { this.#pending.set(key, CanonicalJson.of(value).toValue()); }
  delete(key: string): void { this.#pending.set(key, undefined); }
  keys(): string[] { return [...new Set([...this.#values.keys(), ...this.#pending.keys()])].filter((k) => this.get(k) !== undefined); }

  accept(): void {
    for (const [k, v] of this.#pending) {
      if (v === undefined) this.#values.delete(k); else this.#values.set(k, v);
      this.#changes.set(k, v);
    }
    this.#pending.clear();
  }
  discard(): void { this.#pending.clear(); }
  changes(): Map<string, unknown> { return new Map(this.#changes); }
  clearChanges(): void { this.#changes.clear(); }
}
