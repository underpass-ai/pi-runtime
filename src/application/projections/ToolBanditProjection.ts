import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import { LearningContext } from "../../domain/learning/LearningContext.ts";
import { LearningMode } from "../../domain/learning/LearningMode.ts";
import { SelectionSize } from "../../domain/learning/SelectionSize.ts";
import { SlidingBeta } from "../../domain/learning/SlidingBeta.ts";
import type { BanditArmDto } from "../dto/BanditArmDto.ts";
import type { LearningModeDto } from "../dto/LearningModeDto.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";
import { SelectionWindows } from "../services/SelectionWindows.ts";

type Json = Record<string, unknown>;
// Una decisión abierta: qué tools se observan en su ventana y cuáles ya se vieron.
type Decision = { atMs: number; context: string; phase: string; project: string; narrows: boolean; tracked: string[]; seen: string[]; turns: number };

const SOFT_ZERO_WEIGHT = 0.2;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// Estado del bandit de L1 (spec §6): Beta con ventana por (contexto, tool), decisiones
// abiertas por sesión (SelectionWindows) y modo vigente. Recompensa (spec §3), sólo sobre
// las candidatas expuestas: la primera invocación de cada tool en la ventana cuenta 1 si
// `succeeded` y 0 si `failed` (peso 1); `refused` y `aborted` no cuentan. En una decisión
// active fuera del control, cada tool seleccionada y no usada suma un 0 de peso 0,2 al
// cerrarse la ventana, y sólo si en ella hubo actividad del modelo (un turno o una llamada a
// una tool seguida). Shadow, control y fallback exponían el conjunto completo: sólo
// actualizan las usadas.
export class ToolBanditProjection implements Projection {
  static readonly NAME = ProjectionName.of("tool_bandit");
  static readonly VERSION = 1;
  static readonly MODE_KEY = "mode";
  static readonly OPEN_KEY = "open";
  static readonly DEFAULT_MODE: LearningModeDto = { mode: "shadow", k: SelectionSize.DEFAULT.value };
  readonly name = ToolBanditProjection.NAME;
  readonly version = ToolBanditProjection.VERSION;
  readonly #windows = new SelectionWindows<Decision>(ToolBanditProjection.OPEN_KEY, (state, d) => this.#close(state, d));

  static armKey(context: string, tool: string): string { return `arm|${context}|${tool}`; }
  static candidatesKey(context: string): string { return `candidates|${context}`; }

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record; const p = obj(r.payload.toValue());
    if (r.type.value === "learning.mode_changed") {
      const to = ToolBanditProjection.#mode(p.to, LearningMode.setting);
      if (to !== null) {
        const previous = state.get<LearningModeDto>(ToolBanditProjection.MODE_KEY) ?? ToolBanditProjection.DEFAULT_MODE;
        state.set(ToolBanditProjection.MODE_KEY, { mode: to.value, k: ToolBanditProjection.#k(p.k) ?? previous.k });
      }
    }
    const opened = r.type.value === "tools.selected" ? ToolBanditProjection.#decision(p, r.occurredAt.epochMs()) : null;
    if (opened !== null) state.set(ToolBanditProjection.candidatesKey(opened.context), strings(p.candidates));
    this.#windows.visit(state, e, opened, (d) => {
      if (r.type.value === "turn.completed") { d.turns++; return; }
      const tool = str(p.tool);
      if (r.type.value !== "tool.completed" || tool === null || !d.tracked.includes(tool) || d.seen.includes(tool)) return;
      d.seen.push(tool);
      if (p.status === "succeeded") this.#observe(state, d, tool, 1, 1);
      else if (p.status === "failed") this.#observe(state, d, tool, 0, 1);
    });
  }

  #close(state: ProjectionState, d: Decision): void {
    if (!d.narrows || (d.turns === 0 && d.seen.length === 0)) return;
    for (const tool of d.tracked) if (!d.seen.includes(tool)) this.#observe(state, d, tool, 0, SOFT_ZERO_WEIGHT);
  }

  #observe(state: ProjectionState, d: Decision, tool: string, reward: number, weight: number): void {
    const key = ToolBanditProjection.armKey(d.context, tool);
    let arm: SlidingBeta;
    try { arm = SlidingBeta.fromJson(state.get<BanditArmDto>(key)?.obs ?? []); } catch { arm = SlidingBeta.EMPTY; }
    const dto: BanditArmDto = { context: d.context, phase: d.phase, project: d.project, tool, obs: arm.observe(reward, weight).toJson() };
    state.set(key, dto);
  }

  // Un payload inesperado no abre decisión (spec §9).
  static #decision(p: Json, atMs: number): Decision | null {
    const mode = ToolBanditProjection.#mode(p.mode, LearningMode.of);
    if (mode === null || mode.equals(LearningMode.OFF)) return null;
    let context: LearningContext;
    try { context = LearningContext.parse(p.context); } catch { return null; }
    const candidates = strings(p.candidates);
    const narrows = mode.equals(LearningMode.ACTIVE) && p.control !== true;
    const tracked = narrows ? strings(p.selected).filter((t) => candidates.includes(t)) : candidates;
    return { atMs, context: context.key, phase: context.phase.value, project: context.project.value, narrows, tracked, seen: [], turns: 0 };
  }

  static #mode(raw: unknown, parse: (raw: string) => LearningMode): LearningMode | null {
    try { return parse(raw as string); } catch { return null; }
  }

  static #k(raw: unknown): number | null {
    try { return SelectionSize.of(raw as number).value; } catch { return null; }
  }
}
