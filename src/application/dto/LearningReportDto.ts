import type { LearningContextReportDto } from "./LearningContextReportDto.ts";

// `underpass learning report`: modo vigente, k y un bloque por contexto.
export type LearningReportDto = { mode: string; k: number; contexts: LearningContextReportDto[] };
