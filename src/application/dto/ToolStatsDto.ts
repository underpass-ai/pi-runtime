export type ToolStatsDto = {
  server: string;
  tool: string;
  n: number;
  succeeded: number;
  failed: number;
  refused: number;
  aborted: number;
  durations: number[];
  lastSeen: string;
};
