import type { SessionSummaryDto } from "./SessionSummaryDto.ts";

// Estado de una sesión para /underpass-status: su resumen (null si el log no
// la conoce), la posición global del log y si la cadena de su stream está
// íntegra (una sesión sin eventos cuenta como íntegra).
export type SessionStatusDto = { summary: SessionSummaryDto | null; logPosition: number; sessionChainIntact: boolean };
