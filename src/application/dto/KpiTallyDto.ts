export type KpiTallyDto = {
  sessions: number;
  turns: number;
  cost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  invocations: number;
  refused: number;
  firstTryAttempted: number;
  firstTrySucceeded: number;
  compactions: number;
};
