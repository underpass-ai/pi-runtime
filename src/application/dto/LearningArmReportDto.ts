// Una tool en el informe de L1: media y parámetros de su Beta (con el prior de tool_stats) y n observaciones.
export type LearningArmReportDto = { tool: string; mean: number; alpha: number; beta: number; n: number };
