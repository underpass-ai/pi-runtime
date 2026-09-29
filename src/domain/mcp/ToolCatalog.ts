import { DomainError } from "../shared/DomainError.ts";
import { CatalogFingerprint } from "./CatalogFingerprint.ts";
import type { ServerIdentity } from "./ServerIdentity.ts";
import type { ServerName } from "./ServerName.ts";
import type { ToolDescriptor } from "./ToolDescriptor.ts";
import type { ToolName } from "./ToolName.ts";

export class ToolCatalog {
  readonly server: ServerName; readonly identity: ServerIdentity; readonly #tools: ToolDescriptor[];
  private constructor(s: ServerName, i: ServerIdentity, t: ToolDescriptor[]) { this.server = s; this.identity = i; this.#tools = t; }

  static of(server: ServerName, identity: ServerIdentity, tools: ToolDescriptor[]): ToolCatalog {
    const names = tools.map((t) => t.name.value);
    if (new Set(names).size !== names.length) throw DomainError.because(`duplicate tool in ${server} catalog`);
    return new ToolCatalog(server, identity, [...tools].sort((a, b) => a.name.value.localeCompare(b.name.value)));
  }

  fingerprint(): CatalogFingerprint {
    return CatalogFingerprint.digest(JSON.stringify(this.#tools.map((t) => [t.name.value, t.schema.canonical()])));
  }
  has(name: ToolName): boolean { return this.#tools.some((t) => t.name.equals(name)); }
  names(): ToolName[] { return this.#tools.map((t) => t.name); }
  tools(): ToolDescriptor[] { return [...this.#tools]; }
}
