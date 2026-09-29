export class ProjectionState {
  readonly #values: Map<string, unknown>;
  readonly #pending = new Map<string, unknown>();
  readonly #changes = new Map<string, unknown>();

  constructor(initial: Map<string, unknown>) { this.#values = new Map(initial); }

  get<T>(key: string): T | undefined {
    const v = this.#pending.has(key) ? this.#pending.get(key) : this.#values.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  set(key: string, value: unknown): void { this.#pending.set(key, structuredClone(value)); }
  keys(): string[] { return [...new Set([...this.#values.keys(), ...this.#pending.keys()])]; }

  accept(): void {
    for (const [k, v] of this.#pending) { this.#values.set(k, v); this.#changes.set(k, v); }
    this.#pending.clear();
  }
  discard(): void { this.#pending.clear(); }
  changes(): Map<string, unknown> { return new Map(this.#changes); }
  clearChanges(): void { this.#changes.clear(); }
}
