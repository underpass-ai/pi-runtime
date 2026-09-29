import { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import { McpToolMapper } from "../mappers/McpToolMapper.ts";

const encoder = new TextEncoder();

// Catálogos que el host ya sirvió a Pi (cada extensión pide el suyo al conectar). L1 los usa
// para quitar de las candidatas las tools que el servidor ya no ofrece (spec §9) y para
// estimar los bytes de esquema. Un servidor cuyo catálogo aún no se conoce no filtra nada
// (la selección nunca espera a arrancar un servidor); uno cuyo catálogo falló no aporta
// candidatas, porque Pi tampoco pudo registrar sus tools.
export class KnownCatalogs {
  readonly #catalogs = new Map<string, ToolCatalog | null>();
  readonly #bytes = new Map<string, number>();

  remember(catalog: ToolCatalog): void {
    this.#catalogs.set(catalog.server.value, catalog);
    const mapper = new McpToolMapper();
    for (const t of catalog.tools()) this.#bytes.set(t.name.value, encoder.encode(JSON.stringify(mapper.toDto(t))).length);
  }

  unavailable(server: ServerName): void { this.#catalogs.set(server.value, null); }

  available(names: ToolName[]): ToolName[] {
    return names.filter((n) => {
      const server = ServerName.owning(n);
      const catalog = server === null ? undefined : this.#catalogs.get(server.value);
      return catalog === undefined || (catalog !== null && catalog.has(n));
    });
  }

  // Tamaño de la definición de la tool (nombre, descripción y esquema en JSON); 0 si no se conoce.
  bytesOf(name: ToolName): number { return this.#bytes.get(name.value) ?? 0; }
}
