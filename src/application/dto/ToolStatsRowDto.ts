export type ToolStatsRowDto = {
  server: string;
  tool: string;
  n: number;
  succeeded: number;
  failed: number;
  refused: number;
  aborted: number;
  p50: number | null;
  p95: number | null;
  lastSeen: string;
};
