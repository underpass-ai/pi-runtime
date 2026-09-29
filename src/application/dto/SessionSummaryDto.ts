export type SessionSummaryDto = {
  sessionId: string;
  openedAt: string | null;
  closedAt: string | null;
  phase: string | null;
  model: string | null;
  turns: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
  calls: Record<string, Record<string, number>>;
  failures: number;
  lastEventAt: string;
};
