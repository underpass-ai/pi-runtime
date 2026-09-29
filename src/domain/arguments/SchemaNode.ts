import { JsonType } from "./JsonType.ts";

type Raw = Record<string, unknown>;

// Palabras que el diagnóstico evalúa con exactitud y anotaciones que no restringen nada.
const EXACT = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "oneOf", "anyOf", "allOf",
  "not", "if", "then", "else", "dependentRequired", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "minProperties", "maxProperties"]);
const ANNOTATIONS = new Set(["description", "title", "default", "examples", "deprecated", "readOnly", "writeOnly", "$schema", "$id", "$comment"]);
const DESCRIPTION_MAX = 240;

const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const numberAt = (raw: Raw, key: string): number | null => typeof raw[key] === "number" && Number.isFinite(raw[key]) ? raw[key] as number : null;

// Vista de sólo lectura sobre un (sub)esquema JSON del inputSchema de una tool MCP. Todo lo que
// no reconoce lo deja pasar: un esquema raro nunca produce un rechazo, sólo un diagnóstico peor.
export class SchemaNode {
  readonly #raw: Raw | boolean;
  readonly #children = new Map<string, SchemaNode | SchemaNode[] | Map<string, SchemaNode> | null>();
  private constructor(raw: Raw | boolean) { this.#raw = raw; }
  static of(raw: unknown): SchemaNode { return new SchemaNode(isRaw(raw) || typeof raw === "boolean" ? raw : true); }

  forbidsEverything(): boolean { return this.#raw === false; }
  #object(): Raw { return isRaw(this.#raw) ? this.#raw : {}; }
  #cached<T extends SchemaNode | SchemaNode[] | Map<string, SchemaNode> | null>(key: string, build: () => T): T {
    if (!this.#children.has(key)) this.#children.set(key, build());
    return this.#children.get(key) as T;
  }

  types(): JsonType[] {
    const t = this.#object().type;
    const names = typeof t === "string" ? [t] : Array.isArray(t) ? t : [];
    // Un nombre que no se reconoce invalida el `type` entero: mejor no comprobarlo que comprobar de menos.
    try { return names.map((n) => JsonType.of(n as string)); } catch { return []; }
  }
  description(): string | null {
    const d = this.#object().description;
    if (typeof d !== "string" || d.trim() === "") return null;
    const text = d.trim().replace(/\s+/g, " ");
    return text.length <= DESCRIPTION_MAX ? text : `${text.slice(0, DESCRIPTION_MAX - 1)}…`;
  }
  properties(): Map<string, SchemaNode> {
    return this.#cached("properties", () => {
      const p = this.#object().properties;
      return new Map(isRaw(p) ? Object.entries(p).map(([k, v]) => [k, SchemaNode.of(v)] as const) : []);
    });
  }
  required(): string[] { const r = this.#object().required; return Array.isArray(r) ? r.filter((k): k is string => typeof k === "string") : []; }
  // null: se admite cualquier clave extra; un nodo: las extra deben casar con él.
  additional(): SchemaNode | null {
    return this.#cached("additionalProperties", () => {
      const a = this.#object().additionalProperties;
      return a === undefined || a === true ? null : SchemaNode.of(a);
    });
  }
  closed(): boolean { return this.additional()?.forbidsEverything() === true; }
  items(): SchemaNode | null { return this.#cached("items", () => isRaw(this.#object().items) || typeof this.#object().items === "boolean" ? SchemaNode.of(this.#object().items) : null); }
  hasEnum(): boolean { return Array.isArray(this.#object().enum); }
  enumValues(): unknown[] { const e = this.#object().enum; return Array.isArray(e) ? e : []; }
  hasConst(): boolean { return isRaw(this.#raw) && "const" in this.#raw; }
  constValue(): unknown { return this.#object().const; }
  // El valor que fija una propiedad (su `const` o un `enum` de uno): lo que distingue una rama.
  pinned(): { value: unknown } | null {
    if (this.hasConst()) return { value: this.constValue() };
    return this.enumValues().length === 1 ? { value: this.enumValues()[0] } : null;
  }
  oneOf(): SchemaNode[] { return this.#list("oneOf"); }
  anyOf(): SchemaNode[] { return this.#list("anyOf"); }
  allOf(): SchemaNode[] { return this.#list("allOf"); }
  #list(key: string): SchemaNode[] {
    return this.#cached(key, () => { const v = this.#object()[key]; return Array.isArray(v) ? v.map((s) => SchemaNode.of(s)) : []; });
  }
  #single(key: string): SchemaNode | null {
    return this.#cached(key, () => key in this.#object() ? SchemaNode.of(this.#object()[key]) : null);
  }
  not(): SchemaNode | null { return this.#single("not"); }
  condition(): SchemaNode | null { return this.#single("if"); }
  then(): SchemaNode | null { return this.#single("then"); }
  otherwise(): SchemaNode | null { return this.#single("else"); }
  dependentRequired(): Map<string, string[]> {
    const d = this.#object().dependentRequired;
    if (!isRaw(d)) return new Map();
    return new Map(Object.entries(d).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === "string")] as const));
  }
  minLength(): number | null { return numberAt(this.#object(), "minLength"); }
  maxLength(): number | null { return numberAt(this.#object(), "maxLength"); }
  minimum(): number | null { return numberAt(this.#object(), "minimum"); }
  maximum(): number | null { return numberAt(this.#object(), "maximum"); }
  exclusiveMinimum(): number | null { return numberAt(this.#object(), "exclusiveMinimum"); }
  exclusiveMaximum(): number | null { return numberAt(this.#object(), "exclusiveMaximum"); }
  minItems(): number | null { return numberAt(this.#object(), "minItems"); }
  maxItems(): number | null { return numberAt(this.#object(), "maxItems"); }
  minProperties(): number | null { return numberAt(this.#object(), "minProperties"); }
  maxProperties(): number | null { return numberAt(this.#object(), "maxProperties"); }

  // Si el diagnóstico sabe evaluar este esquema entero con exactitud. `not` e `if` sólo se
  // evalúan cuando lo sabe: invertir una comprobación tolerante daría rechazos falsos.
  exact(): boolean {
    if (typeof this.#raw === "boolean") return true;
    for (const key of Object.keys(this.#raw)) if (!EXACT.has(key) && !ANNOTATIONS.has(key) && !key.startsWith("x-")) return false;
    if (this.types().some((t) => t.value !== "object" && t.value !== "array")) return false; // la coacción de Pi lo hace inexacto
    const nested = [...this.properties().values(), ...this.oneOf(), ...this.anyOf(), ...this.allOf(),
      this.additional(), this.items(), this.not(), this.condition(), this.then(), this.otherwise()];
    return nested.every((n) => n === null || n.exact());
  }

  // La forma esperada en una línea (`{max_iterations, until: {step, output_field, equals}}`),
  // para cuando el esquema no trae descripción.
  shape(depth = 2): string {
    const props = [...this.properties()];
    if (props.length === 0) return "{}";
    return `{${props.map(([k, v]) => depth > 1 && v.properties().size > 0 ? `${k}: ${v.shape(depth - 1)}` : k).join(", ")}}`;
  }
}
