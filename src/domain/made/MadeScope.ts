import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { DomainError } from "../shared/DomainError.ts";

// Campos de identidad de cada tipo de alcance de MADE 0.8.0 (esquema de made_issue_authorization_grant).
const FIELDS: Record<string, string[]> = {
  global: [], ceremony: ["ceremony_id"], ceremony_tree: ["root_id"], definition: ["name"], artifact: ["artifact_id"], council: ["council_id"], budget: ["account_id"],
};
const LABEL: Record<string, string> = { ceremony_tree: "ceremony tree" };
const identity = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);

// Alcance de una decisión o de un grant de MADE, con su forma exacta: tipo y nombre, versión o
// id. Nunca contenido. `key` identifica el alcance; `summary` es la versión legible.
export class MadeScope {
  readonly kind: string; readonly #fields: Record<string, string | null>;
  private constructor(kind: string, fields: Record<string, string | null>) { this.kind = kind; this.#fields = fields; }

  static readonly GLOBAL = new MadeScope("global", {});

  static parse(raw: unknown): MadeScope {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw DomainError.because("MADE scope must be an object");
    const o = raw as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== "string" || !(kind in FIELDS)) throw DomainError.because(`unknown MADE scope kind ${String(kind)}`);
    const fields: Record<string, string | null> = {};
    for (const f of FIELDS[kind]) {
      if (!identity(o[f])) throw DomainError.because(`MADE scope ${kind} needs ${f}`);
      fields[f] = o[f] as string;
    }
    if (kind === "definition") {
      if (o.version !== undefined && o.version !== null && !identity(o.version)) throw DomainError.because("MADE definition scope has an invalid version");
      fields.version = (o.version as string | null | undefined) ?? null;
    }
    return kind === "global" ? MadeScope.GLOBAL : new MadeScope(kind, fields);
  }

  // La forma de MADE, para emitir el grant y para los hechos.
  toJson(): Record<string, string | null> { return { kind: this.kind, ...this.#fields }; }
  get key(): string { return CanonicalJson.of(this.toJson()).text; }
  equals(o: MadeScope): boolean { return o.key === this.key; }

  summary(): string {
    if (this.kind === "global") return "global";
    if (this.kind === "definition") return `definition ${this.#fields.name}${this.#fields.version === null ? "" : ` v${this.#fields.version}`}`;
    return `${LABEL[this.kind] ?? this.kind} ${Object.values(this.#fields)[0]}`;
  }
}
