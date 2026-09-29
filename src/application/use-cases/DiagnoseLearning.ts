import { Check } from "../../domain/diagnosis/Check.ts";
import { CheckDetail } from "../../domain/diagnosis/CheckDetail.ts";
import { CheckName } from "../../domain/diagnosis/CheckName.ts";
import { CheckSection } from "../../domain/diagnosis/CheckSection.ts";
import type { EvalGroupDto } from "../dto/EvalGroupDto.ts";
import type { LearningEvalDto } from "../dto/LearningEvalDto.ts";
import type { LearningModeDto } from "../dto/LearningModeDto.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { LearningEvalProjection } from "../projections/LearningEvalProjection.ts";
import { ToolBanditProjection } from "../projections/ToolBanditProjection.ts";

const S = CheckSection.LEARNING;
const MIN_N = 50;
const MAX_GAP = 0.05;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ok = (n: string, d: string) => Check.ok(S, CheckName.of(n), CheckDetail.of(d));
const warn = (n: string, d: string) => Check.warn(S, CheckName.of(n), CheckDetail.of(d));

// Sección [learning] de doctor (spec §8): WARN si las proyecciones de L1 van por detrás;
// en active, WARN si el control acierta a la primera más de 5 puntos por encima del tratado
// con n ≥ 50 primeras invocaciones en cada grupo. off y shadow son OK.
export class DiagnoseLearning {
  readonly #events: EventStore; readonly #store: ProjectionStore;
  constructor(events: EventStore, store: ProjectionStore) { this.#events = events; this.#store = store; }

  execute(): Check[] { return [this.#projections(), this.#mode()]; }

  #projections(): Check {
    const last = this.#events.lastPosition().value;
    const problems: string[] = [];
    const list: Projection[] = [new ToolBanditProjection(), new LearningEvalProjection()];
    for (const p of list) {
      const quarantined = this.#store.quarantined(p.name).length;
      if (quarantined > 0) problems.push(`${p.name.value} has ${quarantined} quarantined events`);
      if (last === 0) continue;
      const c = this.#store.cursor(p.name);
      if (c === null || c.version !== p.version) problems.push(`${p.name.value} not built yet`);
      else if (c.position.value < last) problems.push(`${p.name.value} at ${c.position.value}/${last}`);
    }
    if (problems.length > 0) return warn("learning projections", `${problems.join("; ")}; start pi in this project or run underpass events rebuild <projection>`);
    return ok("learning projections", last === 0 ? "no events yet" : "up to date");
  }

  #mode(): Check {
    const mode = (this.#store.load(ToolBanditProjection.NAME).get(ToolBanditProjection.MODE_KEY) as LearningModeDto | undefined) ?? ToolBanditProjection.DEFAULT_MODE;
    const evals = [...this.#store.load(LearningEvalProjection.NAME)].filter(([k]) => k.startsWith("context|")).map(([, v]) => v as LearningEvalDto);
    if (mode.mode === "off") return ok("learning mode", "off");
    if (mode.mode === "shadow") {
      const used = evals.reduce((s, x) => s + x.shadow.used, 0); const missed = evals.reduce((s, x) => s + x.shadow.missed, 0);
      const decisions = evals.reduce((s, x) => s + x.shadow.decisions, 0);
      return ok("learning mode", `shadow (k=${mode.k}), ${decisions} decisions${used > 0 ? `, miss ${pct(missed / used)}` : ""}`);
    }
    const sum = (pick: (x: LearningEvalDto) => EvalGroupDto) => evals.reduce((a, x) => ({ n: a.n + pick(x).firstTryAttempted, ok: a.ok + pick(x).firstTrySucceeded }), { n: 0, ok: 0 });
    const treated = sum((x) => x.treated); const control = sum((x) => x.control);
    const rate = (g: { n: number; ok: number }) => (g.n > 0 ? g.ok / g.n : null);
    const t = rate(treated); const c = rate(control);
    const detail = `active (k=${mode.k}), first-try treated ${t === null ? "-" : pct(t)} (n=${treated.n}) vs control ${c === null ? "-" : pct(c)} (n=${control.n})`;
    if (t !== null && c !== null && treated.n >= MIN_N && control.n >= MIN_N && c - t > MAX_GAP) return warn("learning mode", `${detail}; the control group does better: run underpass learning mode shadow`);
    return ok("learning mode", detail);
  }
}
