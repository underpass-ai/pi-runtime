import type { StorePath } from "../../domain/made/StorePath.ts";

// Cuántas políticas de autorización guarda el store de MADE (más de una: lo comparte otra
// instalación, p. ej. el plugin de Claude Code). null si no existe o no se puede leer.
export interface MadePolicyCensus { policies(store: StorePath): number | null; }
