import type { LearningArmReportDto } from "./LearningArmReportDto.ts";
import type { LearningGroupReportDto } from "./LearningGroupReportDto.ts";

// Un contexto (fase, proyecto) del informe de L1: sus tools y la evaluación (spec §8).
export type LearningContextReportDto = {
  phase: string; project: string; tools: LearningArmReportDto[];
  shadow: { decisions: number; missRate: number | null; toolSavings: number | null; byteSavings: number | null };
  treated: LearningGroupReportDto; control: LearningGroupReportDto;
};
