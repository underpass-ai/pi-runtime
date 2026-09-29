import type { StorePath } from "../../domain/made/StorePath.ts";
import type { MadeStoreCensusDto } from "../dto/MadeStoreCensusDto.ts";

// El censo del store de MADE: políticas y grants que no emitió pi-runtime (otro cliente de MADE,
// p. ej. el plugin de Claude Code, que con la misma configuración actúa como el mismo principal).
// null si no existe o no se puede leer.
export interface MadePolicyCensus { census(store: StorePath): MadeStoreCensusDto | null; }
