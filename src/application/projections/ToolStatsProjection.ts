import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import type { ToolStatsDto } from "../dto/ToolStatsDto.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";

const RESERVOIR = 200;
const STATUSES = ["succeeded", "failed", "refused", "aborted"] as const;

export class ToolStatsProjection implements Projection {
  static readonly NAME = ProjectionName.of("tool_stats");
  readonly name = ToolStatsProjection.NAME;
  readonly version = 1;

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record;
    if (r.type.value !== "tool.completed") return;
    const p = r.payload.toValue() as Record<string, unknown>;
    const tool = typeof p.tool === "string" ? p.tool : "unknown";
    const server = typeof p.server === "string" ? p.server : "unknown";
    const key = `tool:${server}:${tool}`;
    const s = state.get<ToolStatsDto>(key) ?? { server, tool, n: 0, succeeded: 0, failed: 0, refused: 0, aborted: 0, durations: [], lastSeen: r.occurredAt.value };
    s.n++;
    const status = STATUSES.find((x) => x === p.status);
    if (status !== undefined) s[status]++;
    if (typeof p.durationMs === "number" && Number.isFinite(p.durationMs)) s.durations = [...s.durations, p.durationMs].slice(-RESERVOIR);
    s.lastSeen = r.occurredAt.value;
    state.set(key, s);
  }
}
