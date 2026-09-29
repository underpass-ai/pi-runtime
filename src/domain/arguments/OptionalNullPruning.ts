import type { SchemaNode } from "./SchemaNode.ts";

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Un opcional a null equivale a omitirlo: el host (Pi 0.87.1, `normalizeOptionalNulls`) los quita
// antes de validar, bajando por `properties` e `items`, cuando el esquema de la propiedad no admite
// null. Se reproduce aquí para no señalar lo que el host acabaría aceptando.
export class OptionalNullPruning {
  private constructor() {}
  static apply(node: SchemaNode, value: unknown): unknown {
    if (Array.isArray(value)) {
      const items = node.items();
      return items === null ? value : value.map((v) => OptionalNullPruning.apply(items, v));
    }
    if (!isPlainObject(value)) return value;
    const props = node.properties(), required = node.required();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const prop = props.get(k);
      if (prop === undefined) { out[k] = v; continue; }
      if (v === null && !required.includes(k) && OptionalNullPruning.#refusesNull(prop)) continue;
      out[k] = OptionalNullPruning.apply(prop, v);
    }
    return out;
  }
  // Sólo cuando es seguro que el esquema rechaza null; en la duda se conserva.
  static #refusesNull(node: SchemaNode): boolean {
    if (node.forbidsEverything()) return true;
    const types = node.types();
    if (types.length > 0) return !types.some((t) => t.value === "null");
    if (node.hasConst()) return node.constValue() !== null;
    if (node.hasEnum()) return !node.enumValues().includes(null);
    return false;
  }
}
