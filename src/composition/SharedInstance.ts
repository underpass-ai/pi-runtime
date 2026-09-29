// Pi carga cada fichero de extensión (host.ts, kmp.ts, made.ts) con jiti en
// un realm de módulos propio (moduleCache: false), así que un campo estático
// de clase NO se comparte entre extensiones: cada una ve su propia copia de
// ExtensionComposition. globalThis sí es el mismo objeto de proceso en los
// tres casos, así que usamos un registro ahí para lograr un singleton real
// entre extensiones.
const REGISTRY_KEY = Symbol.for("pi-runtime.shared-instances");

export class SharedInstance {
  static get<T>(key: string, factory: () => T): T {
    const registry = SharedInstance.#registry();
    if (!registry.has(key)) registry.set(key, factory());
    return registry.get(key) as T;
  }

  static #registry(): Map<string, unknown> {
    const g = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Map<string, unknown> };
    if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
    return g[REGISTRY_KEY];
  }
}
