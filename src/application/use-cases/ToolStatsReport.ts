import type { ToolStatsDto } from "../dto/ToolStatsDto.ts";
import type { ToolStatsRowDto } from "../dto/ToolStatsRowDto.ts";
import { ToolStatsProjection } from "../projections/ToolStatsProjection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";

const percentile = (values: number[], q: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
};

export class ToolStatsReport {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }
  execute(): ToolStatsRowDto[] {
    return [...this.#store.load(ToolStatsProjection.NAME).values()].map((v) => {
      const s = v as ToolStatsDto;
      return { server: s.server, tool: s.tool, n: s.n, succeeded: s.succeeded, failed: s.failed, refused: s.refused, aborted: s.aborted,
        p50: percentile(s.durations, 0.5), p95: percentile(s.durations, 0.95), lastSeen: s.lastSeen };
    }).sort((a, b) => b.n - a.n || a.tool.localeCompare(b.tool));
  }
}
