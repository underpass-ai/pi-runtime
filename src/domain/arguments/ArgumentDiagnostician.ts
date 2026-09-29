import { CanonicalJson } from "../shared/CanonicalJson.ts";
import type { JsonSchema } from "../mcp/JsonSchema.ts";
import { ArgumentDiagnosis } from "./ArgumentDiagnosis.ts";
import { ArgumentPath } from "./ArgumentPath.ts";
import { ArgumentProblem } from "./ArgumentProblem.ts";
import { BranchRanking } from "./BranchRanking.ts";
import { JsonType } from "./JsonType.ts";
import { OptionalNullPruning } from "./OptionalNullPruning.ts";
import { SchemaNode } from "./SchemaNode.ts";

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => { try { return CanonicalJson.of(a).equals(CanonicalJson.of(b)); } catch { return false; } };
const quoted = (keys: readonly string[]) => keys.map((k) => JSON.stringify(k)).join(", ");
const literal = (v: unknown) => { const s = JSON.stringify(v) ?? String(v); return s.length <= 60 ? s : `${s.slice(0, 59)}…`; };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ALTERNATIVE_DETAIL = 3;

// Servicio de dominio: revisa unos argumentos contra el inputSchema MCP de su tool y dice, con
// ruta, qué no casa. Cubre el subconjunto de JSON Schema que usan MADE y KMP; lo demás no lo
// evalúa (lo deja pasar: Pi valida después con el esquema completo). De un oneOf/anyOf sólo
// informa de la rama que el modelo parecía querer, nunca de la cascada de todas.
export class ArgumentDiagnostician {
  readonly #root: SchemaNode;
  private constructor(root: SchemaNode) { this.#root = root; }
  static for(schema: JsonSchema): ArgumentDiagnostician { return new ArgumentDiagnostician(SchemaNode.of(schema.toJson())); }

  diagnose(args: unknown): ArgumentDiagnosis {
    const problems = this.#check(this.#root, OptionalNullPruning.apply(this.#root, args), ArgumentPath.ROOT);
    return problems.length === 0 ? ArgumentDiagnosis.CLEAN : ArgumentDiagnosis.of(problems);
  }

  #check(node: SchemaNode, value: unknown, path: ArgumentPath): ArgumentProblem[] {
    if (node.forbidsEverything()) return [ArgumentProblem.at(path, "is not allowed here")];
    const types = node.types();
    if (types.length > 0 && !types.some((t) => t.admits(value))) {
      return [ArgumentProblem.at(path, `expected ${types.map((t) => t.value).join(" or ")}, got ${JsonType.nameOf(value)}`, node.description())];
    }
    const problems: ArgumentProblem[] = [];
    const lenientString = types.some((t) => t.value === "string") && (typeof value === "number" || typeof value === "boolean");
    const equalsLiteral = (l: unknown) => same(l, value) || (lenientString && l === String(value));
    if (node.hasConst() && !equalsLiteral(node.constValue())) problems.push(ArgumentProblem.at(path, `must be ${literal(node.constValue())}, got ${literal(value)}`));
    if (node.hasEnum() && !node.enumValues().some(equalsLiteral)) {
      problems.push(ArgumentProblem.at(path, `${literal(value)} is not one of: ${node.enumValues().map(literal).join(", ")}`, node.description()));
    }
    if (typeof value === "string") problems.push(...this.#string(node, value, path));
    if (typeof value === "number") problems.push(...this.#number(node, value, path));
    if (Array.isArray(value)) problems.push(...this.#array(node, value, path));
    if (isPlainObject(value)) problems.push(...this.#object(node, value, path));
    for (const part of node.allOf()) problems.push(...this.#check(part, value, path));
    problems.push(...this.#conditional(node, value, path));
    problems.push(...this.#negation(node, value, path));
    if (node.oneOf().length > 0) problems.push(...this.#alternatives(node.oneOf(), value, path));
    if (node.anyOf().length > 0) problems.push(...this.#alternatives(node.anyOf(), value, path));
    return problems;
  }

  #string(node: SchemaNode, value: string, path: ArgumentPath): ArgumentProblem[] {
    const length = [...value].length, min = node.minLength(), max = node.maxLength();
    if (min !== null && length < min) return [ArgumentProblem.at(path, min === 1 ? "must not be empty" : `must have at least ${plural(min, "character", "characters")}`, node.description())];
    if (max !== null && length > max) return [ArgumentProblem.at(path, `must have at most ${plural(max, "character", "characters")}`, node.description())];
    return [];
  }

  #number(node: SchemaNode, value: number, path: ArgumentPath): ArgumentProblem[] {
    const bounds: [number | null, (n: number) => boolean, string][] = [
      [node.minimum(), (n) => value >= n, ">="], [node.maximum(), (n) => value <= n, "<="],
      [node.exclusiveMinimum(), (n) => value > n, ">"], [node.exclusiveMaximum(), (n) => value < n, "<"],
    ];
    return bounds.filter(([n, ok]) => n !== null && !ok(n)).map(([n, , op]) => ArgumentProblem.at(path, `must be ${op} ${n}, got ${value}`, node.description()));
  }

  #array(node: SchemaNode, value: unknown[], path: ArgumentPath): ArgumentProblem[] {
    const problems: ArgumentProblem[] = [];
    const min = node.minItems(), max = node.maxItems();
    if (min !== null && value.length < min) problems.push(ArgumentProblem.at(path, `must have at least ${plural(min, "item", "items")}`, node.description()));
    if (max !== null && value.length > max) problems.push(ArgumentProblem.at(path, max === 0 ? "must be empty" : `must have at most ${plural(max, "item", "items")}`, node.description()));
    const items = node.items();
    if (items !== null) value.forEach((v, i) => problems.push(...this.#check(items, v, path.index(i))));
    return problems;
  }

  #object(node: SchemaNode, value: Record<string, unknown>, path: ArgumentPath): ArgumentProblem[] {
    const own: ArgumentProblem[] = [], nested: ArgumentProblem[] = [];
    const props = node.properties(), required = node.required();
    const present = (k: string) => Object.hasOwn(value, k) && value[k] !== undefined;
    const extra: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      const prop = props.get(k);
      if (prop === undefined) { extra.push(k); continue; }
      // Pi quita los opcionales a null antes de validar.
      if (v === null && !required.includes(k)) continue;
      if (v !== undefined) nested.push(...this.#check(prop, v, path.field(k)));
    }
    const additional = node.additional();
    if (extra.length > 0 && node.closed()) {
      const allowed = props.size > 0 ? `; allowed: ${[...props.keys()].join(", ")}` : "; no fields are allowed";
      own.push(ArgumentProblem.at(path, `unknown ${extra.length === 1 ? "field" : "fields"} ${quoted(extra)}${allowed}`, ArgumentDiagnostician.#hint(node)));
    } else if (additional !== null) {
      for (const k of extra) nested.push(...this.#check(additional, value[k], path.field(k)));
    }
    for (const k of required.filter((k) => !present(k))) {
      const about = props.get(k)?.description();
      own.push(ArgumentProblem.at(path, `missing required field ${JSON.stringify(k)}${about ? ` (${about})` : ""}`));
    }
    for (const [k, deps] of node.dependentRequired()) {
      const lacking = present(k) ? deps.filter((d) => !present(d)) : [];
      if (lacking.length > 0) own.push(ArgumentProblem.at(path, `field ${JSON.stringify(k)} also needs ${quoted(lacking)}`));
    }
    const count = Object.keys(value).length, minP = node.minProperties(), maxP = node.maxProperties();
    if (minP !== null && count < minP) own.push(ArgumentProblem.at(path, `must have at least ${plural(minP, "field", "fields")}`, node.description()));
    if (maxP !== null && count > maxP) own.push(ArgumentProblem.at(path, `must have at most ${plural(maxP, "field", "fields")}`, node.description()));
    return [...own, ...nested];
  }

  // Lo que el esquema dice del objeto: su descripción y, si anida objetos, su forma.
  static #hint(node: SchemaNode): string | null {
    const nests = [...node.properties().values()].some((p) => p.properties().size > 0);
    const parts = [node.description(), nests ? `expected ${node.shape()}` : null].filter((p) => p !== null);
    return parts.length > 0 ? parts.join(" — ") : null;
  }

  #conditional(node: SchemaNode, value: unknown, path: ArgumentPath): ArgumentProblem[] {
    const condition = node.condition();
    if (condition === null || !condition.exact()) return [];
    const branch = this.#check(condition, value, path).length === 0 ? node.then() : node.otherwise();
    return branch === null ? [] : this.#check(branch, value, path);
  }

  #negation(node: SchemaNode, value: unknown, path: ArgumentPath): ArgumentProblem[] {
    const forbidden = node.not();
    if (forbidden === null || !forbidden.exact() || this.#check(forbidden, value, path).length > 0) return [];
    const keys = forbidden.required();
    if (keys.length === 1) return [ArgumentProblem.at(path, `field ${JSON.stringify(keys[0])} is not allowed here`)];
    if (keys.length > 1) return [ArgumentProblem.at(path, `fields ${quoted(keys)} must not all be present`)];
    return [ArgumentProblem.at(path, "has a shape that is not allowed here")];
  }

  #alternatives(branches: SchemaNode[], value: unknown, path: ArgumentPath): ArgumentProblem[] {
    const attempts = branches.map((branch) => ({ branch, problems: this.#check(branch, value, path) }));
    if (attempts.some((a) => a.problems.length === 0)) return [];
    const typed = branches.every((b) => b.types().length > 0);
    if (typed && branches.every((b) => !b.types().some((t) => t.admits(value)))) {
      const names = [...new Set(branches.flatMap((b) => b.types().map((t) => t.value)))];
      return [ArgumentProblem.at(path, `expected ${names.join(" or ")}, got ${JsonType.nameOf(value)}`)];
    }
    const best = BranchRanking.best(value, attempts);
    if (best.length === 1) return best[0].problems;
    const options = best.map((a) => a.problems.slice(0, ALTERNATIVE_DETAIL)
      .map((p) => p.path.equals(path) ? p.message : `${p.path}: ${p.message}`).join(", "));
    return [ArgumentProblem.at(path, `matches none of the ${branches.length} accepted shapes; either ${options.join("; or ")}`)];
  }
}
