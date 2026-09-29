import { CanonicalJson } from "../shared/CanonicalJson.ts";
import type { ArgumentProblem } from "./ArgumentProblem.ts";
import type { SchemaNode } from "./SchemaNode.ts";

type Attempt = { branch: SchemaNode; problems: ArgumentProblem[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => { try { return CanonicalJson.of(a).equals(CanonicalJson.of(b)); } catch { return false; } };

// Qué rama de un oneOf/anyOf quería el modelo cuando no casa ninguna. Manda, por orden: que el
// tipo encaje, que las propiedades fijadas (`kind`, `strategy`…) no contradigan y sí coincidan,
// que las claves presentes existan en la rama, y al final el número de fallos. Así una etapa con
// `group` es la rama grupo aunque le sobren o falten cosas, y sólo se informa de esa rama.
export class BranchRanking {
  private constructor() {}
  static best(value: unknown, attempts: readonly Attempt[]): Attempt[] {
    const scored = attempts.map((a) => ({ a, key: BranchRanking.#key(a, value) }));
    scored.sort((x, y) => BranchRanking.#compare(x.key, y.key));
    const top = scored[0].key;
    return scored.filter((s) => BranchRanking.#compare(s.key, top) === 0).map((s) => s.a);
  }
  // Menor es mejor en cada posición.
  static #key({ branch, problems }: Attempt, value: unknown): number[] {
    const types = branch.types();
    const typeMiss = types.length > 0 && !types.some((t) => t.admits(value)) ? 1 : 0;
    let mismatch = 0, match = 0, known = 0, unknown = 0;
    if (isPlainObject(value)) {
      const props = branch.properties();
      for (const [k, v] of Object.entries(value)) {
        const prop = props.get(k);
        if (prop === undefined) { if (branch.closed()) unknown++; continue; }
        known++;
        const pin = prop.pinned();
        if (pin !== null) { if (same(pin.value, v)) match++; else mismatch++; }
      }
    }
    return [typeMiss, mismatch, -match, unknown, -known, problems.length];
  }
  static #compare(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
}
