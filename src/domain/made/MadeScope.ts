import { CanonicalJson } from "../shared/CanonicalJson.ts";
import { DomainError } from "../shared/DomainError.ts";
import { CeremonyId } from "./CeremonyId.ts";

// Campos de identidad de cada tipo de alcance de MADE 0.8.0 y 0.9.0 (esquema de made_issue_authorization_grant).
const FIELDS: Record<string, string[]> = {
  global: [], ceremony: ["ceremony_id"], ceremony_tree: ["root_id"], definition: ["name"], artifact: ["artifact_id"], council: ["council_id"], budget: ["account_id"],
};
const LABEL: Record<string, string> = { ceremony_tree: "ceremony tree" };
// Citado como JSON y sin marcas de dirección (bidi), que podrían reordenar el texto en la TUI.
const quote = (v: string | null): string => JSON.stringify(v).replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const identity = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);

// Alcance de una decisión o de un grant de MADE, con su forma exacta: tipo y nombre, versión o
// id. Nunca contenido. `key` identifica el alcance; `summary` es la versión legible.
export class MadeScope {
  readonly kind: string; readonly #fields: Record<string, string | null>;
  private constructor(kind: string, fields: Record<string, string | null>) { this.kind = kind; this.#fields = fields; }

  static readonly GLOBAL = new MadeScope("global", {});

  // El alcance de una instancia de ceremonia (F3): la forma que MADE 0.8.0 y 0.9.0 ponen en las decisiones
  // de start_published_ceremony, claim, transición, lecturas de la instancia…
  static ceremony(id: CeremonyId): MadeScope { return new MadeScope("ceremony", { ceremony_id: id.value }); }

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
  // La instancia si el alcance es `ceremony`; null si es de otro tipo.
  ceremonyId(): CeremonyId | null { return this.kind === "ceremony" ? CeremonyId.of(this.#fields.ceremony_id as string) : null; }
  get key(): string { return CanonicalJson.of(this.toJson()).text; }
  equals(o: MadeScope): boolean { return o.key === this.key; }

  summary(): string {
    if (this.kind === "global") return "global";
    if (this.kind === "definition") return `definition ${this.#fields.name}${this.#fields.version === null ? "" : ` v${this.#fields.version}`}`;
    return `${LABEL[this.kind] ?? this.kind} ${Object.values(this.#fields)[0]}`;
  }

  // Para la pregunta de la TUI: lo que eligió el modelo (nombre, versión, id) va citado, así nunca
  // se lee como parte del texto de la pregunta.
  label(): string {
    if (this.kind === "global") return "Global scope (every resource)";
    const kind = LABEL[this.kind] ?? this.kind;
    const head = `${kind[0].toUpperCase()}${kind.slice(1)} ${quote(Object.values(this.#fields)[0])}`;
    const version = this.#fields.version;
    if (this.kind !== "definition" || version === null) return head;
    return /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version) ? `${head} v${version}` : `${head} version ${quote(version)}`;
  }
}
