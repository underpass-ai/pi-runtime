// Un grupo de active en el informe: tasas (null sin datos) y n de primeras invocaciones.
export type LearningGroupReportDto = { decisions: number; firstTry: number | null; firstTryN: number; turnsPerRequest: number | null; refusalRate: number | null };
