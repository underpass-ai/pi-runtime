// Ratios null cuando el denominador es 0 (no hay datos, no es un 0 %).
export type QualityKpisDto = {
  scope: string;
  sessions: number;
  turns: number;
  cost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  invocations: number;
  firstTrySuccess: number | null;
  refusalRate: number | null;
  cacheRatio: number | null;
  compactions: number;
  compactionsPerSession: number | null;
};
