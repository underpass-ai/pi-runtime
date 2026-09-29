import type { ExporterStatusDto } from "./ExporterStatusDto.ts";
import type { LearningStatusDto } from "./LearningStatusDto.ts";
import type { QualityKpisDto } from "./QualityKpisDto.ts";
import type { SessionSummaryDto } from "./SessionSummaryDto.ts";

// Estado de una sesión para /underpass-status: su resumen (null si el log no la conoce),
// la posición global del log, si la cadena de su stream está íntegra (una sesión sin
// eventos cuenta como íntegra), sus KPIs y el estado del exportador OTLP. kpis y exporter
// son opcionales: un host de una versión anterior no los envía; learning (L1), igual.
export type SessionStatusDto = {
  summary: SessionSummaryDto | null;
  logPosition: number;
  sessionChainIntact: boolean;
  kpis?: QualityKpisDto | null;
  exporter?: ExporterStatusDto;
  learning?: LearningStatusDto;
};
