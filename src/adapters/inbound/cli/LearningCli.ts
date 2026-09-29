import type { LearningContextReportDto } from "../../../application/dto/LearningContextReportDto.ts";
import type { LearningGroupReportDto } from "../../../application/dto/LearningGroupReportDto.ts";
import { LearningEvalProjection } from "../../../application/projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../../../application/projections/ToolBanditProjection.ts";
import type { ChangeLearningMode } from "../../../application/use-cases/ChangeLearningMode.ts";
import type { LearningReport } from "../../../application/use-cases/LearningReport.ts";
import type { ProjectionLag } from "../../../application/use-cases/ProjectionLag.ts";
import { LearningMode } from "../../../domain/learning/LearningMode.ts";
import { SelectionSize } from "../../../domain/learning/SelectionSize.ts";
import { Phase } from "../../../domain/session/Phase.ts";

type Deps = { report: LearningReport; mode: ChangeLearningMode; lag: ProjectionLag; print: (s: string) => void };
const USAGE = "usage: underpass learning report [--context <phase>] | mode shadow|active|off [--k N]";
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null) => (v === null ? "-" : v.toFixed(2));

// `underpass learning report [--context <fase>]` y `underpass learning mode shadow|active|off [--k N]`.
export class LearningCli {
  readonly #d: Deps;
  constructor(deps: Deps) { this.#d = deps; }

  run(args: string[]): number {
    const d = this.#d;
    try {
      if (args[0] === "report") {
        let phase: Phase | undefined;
        if (args.length === 3 && args[1] === "--context") { try { phase = Phase.of(args[2]); } catch { return this.#usage(); } }
        else if (args.length !== 1) return this.#usage();
        this.#report(phase);
        return 0;
      }
      if (args[0] === "mode") {
        const withK = args.length === 4 && args[2] === "--k" && /^\d+$/.test(args[3]);
        if (args.length !== 2 && !withK) return this.#usage();
        let mode: LearningMode; let k: SelectionSize | null = null;
        try { mode = LearningMode.setting(args[1]); if (withK) k = SelectionSize.of(Number(args[3])); }
        catch (e) { d.print(`error: ${(e as Error).message}`); return 2; }
        const changed = d.mode.execute(mode, k);
        d.print(`learning mode ${changed.from} -> ${changed.to} (k=${changed.k})`);
        return 0;
      }
      return this.#usage();
    } catch (e) {
      d.print(`error: ${(e as Error).message}`);
      return 1;
    }
  }

  #report(phase: Phase | undefined): void {
    const d = this.#d;
    for (const name of [ToolBanditProjection.NAME, LearningEvalProjection.NAME]) {
      for (const b of d.lag.execute(name)) d.print(`projections behind (${b.position}/${b.last}): start pi in this project or run underpass events rebuild ${b.projection}`);
    }
    const r = d.report.execute(phase);
    d.print(`mode ${r.mode} (k=${r.k})`);
    if (r.contexts.length === 0) { d.print("no learning decisions recorded yet"); return; }
    for (const c of r.contexts) this.#context(c);
  }

  #context(c: LearningContextReportDto): void {
    const p = this.#d.print;
    p(`context ${c.phase} · project ${c.project}`);
    for (const t of c.tools) p(`  ${t.tool.padEnd(34)} mean=${t.mean.toFixed(3)}  alpha=${t.alpha.toFixed(2)}  beta=${t.beta.toFixed(2)}  n=${t.n}`);
    const s = c.shadow;
    p(`  shadow   decisions=${s.decisions}  miss=${pct(s.missRate)}  savings=${pct(s.toolSavings)} tools, ${pct(s.byteSavings)} schema bytes`);
    p(`  active   treated ${LearningCli.#group(c.treated)}`);
    p(`           control ${LearningCli.#group(c.control)}`);
  }

  static #group(g: LearningGroupReportDto): string {
    return `decisions=${g.decisions}  first-try=${pct(g.firstTry)} (n=${g.firstTryN})  turns/request=${num(g.turnsPerRequest)}  refusals=${pct(g.refusalRate)}`;
  }

  #usage(): number { this.#d.print(USAGE); return 2; }
}
