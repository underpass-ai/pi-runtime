import { SlidingBeta } from "../../domain/learning/SlidingBeta.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Phase } from "../../domain/session/Phase.ts";
import type { BanditArmDto } from "../dto/BanditArmDto.ts";
import type { EvalGroupDto } from "../dto/EvalGroupDto.ts";
import type { LearningContextReportDto } from "../dto/LearningContextReportDto.ts";
import type { LearningEvalDto } from "../dto/LearningEvalDto.ts";
import type { LearningGroupReportDto } from "../dto/LearningGroupReportDto.ts";
import type { LearningModeDto } from "../dto/LearningModeDto.ts";
import type { LearningReportDto } from "../dto/LearningReportDto.ts";
import type { ToolStatsDto } from "../dto/ToolStatsDto.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { LearningEvalProjection } from "../projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../projections/ToolStatsProjection.ts";

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

// Informe de L1 (spec §8) a partir de tool_bandit, learning_eval y tool_stats. Por contexto,
// sólo las tools de su última lista de candidatas: las que desaparecieron del catálogo no salen.
export class LearningReport {
  readonly #store: ProjectionStore;
  constructor(store: ProjectionStore) { this.#store = store; }

  execute(phase?: Phase): LearningReportDto {
    const bandit = this.#store.load(ToolBanditProjection.NAME); const evals = this.#store.load(LearningEvalProjection.NAME); const stats = this.#store.load(ToolStatsProjection.NAME);
    const mode = (bandit.get(ToolBanditProjection.MODE_KEY) as LearningModeDto | undefined) ?? ToolBanditProjection.DEFAULT_MODE;
    const contexts = new Map<string, { phase: string; project: string }>();
    for (const [key, v] of [...bandit, ...evals]) {
      if (key.startsWith("arm|")) { const a = v as BanditArmDto; contexts.set(a.context, { phase: a.phase, project: a.project }); }
      if (key.startsWith("context|")) { const x = v as LearningEvalDto; contexts.set(x.context, { phase: x.phase, project: x.project }); }
    }
    const rows = [...contexts].filter(([, c]) => phase === undefined || c.phase === phase.value).sort(([a], [b]) => a.localeCompare(b))
      .map(([context, c]): LearningContextReportDto => {
        const current = (bandit.get(ToolBanditProjection.candidatesKey(context)) as string[] | undefined) ?? [];
        const tools = current.map((tool) => {
          let arm: SlidingBeta;
          try { arm = SlidingBeta.fromJson((bandit.get(ToolBanditProjection.armKey(context, tool)) as BanditArmDto | undefined)?.obs ?? []); } catch { arm = SlidingBeta.EMPTY; }
          const successes = LearningReport.#successes(stats, tool);
          return { tool, mean: arm.mean(successes), alpha: arm.alpha(successes), beta: arm.beta(), n: arm.n };
        }).sort((a, b) => b.mean - a.mean || a.tool.localeCompare(b.tool));
        const x = evals.get(LearningEvalProjection.contextKey(context)) as LearningEvalDto | undefined;
        const s = x?.shadow;
        return {
          phase: c.phase, project: c.project, tools,
          shadow: { decisions: s?.decisions ?? 0, missRate: s ? ratio(s.missed, s.used) : null, toolSavings: s && s.fullTools > 0 ? 1 - s.exposedTools / s.fullTools : null,
            byteSavings: s && s.fullBytes > 0 ? 1 - s.exposedBytes / s.fullBytes : null },
          treated: LearningReport.#group(x?.treated), control: LearningReport.#group(x?.control),
        };
      });
    return { mode: mode.mode, k: mode.k, contexts: rows };
  }

  static #group(g: EvalGroupDto | undefined): LearningGroupReportDto {
    const x = g ?? LearningEvalProjection.emptyGroup();
    return { decisions: x.decisions, firstTry: ratio(x.firstTrySucceeded, x.firstTryAttempted), firstTryN: x.firstTryAttempted,
      turnsPerRequest: ratio(x.turns, x.decisions), refusalRate: ratio(x.refused, x.invocations) };
  }

  static #successes(stats: Map<string, unknown>, tool: string): number {
    let server: ServerName | null;
    try { server = ServerName.owning(ToolName.of(tool)); } catch { return 0; }
    return server === null ? 0 : (stats.get(`tool:${server.value}:${tool}`) as ToolStatsDto | undefined)?.succeeded ?? 0;
  }
}
