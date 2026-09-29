import { ProjectionName } from "../../domain/events/ProjectionName.ts";
import type { StoredEvent } from "../../domain/events/StoredEvent.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { LearningContext } from "../../domain/learning/LearningContext.ts";
import { LearningMode } from "../../domain/learning/LearningMode.ts";
import type { EvalGroupDto } from "../dto/EvalGroupDto.ts";
import type { LearningEvalDto } from "../dto/LearningEvalDto.ts";
import type { SessionLearningDto } from "../dto/SessionLearningDto.ts";
import type { Projection } from "../ports/Projection.ts";
import type { ProjectionState } from "../services/ProjectionState.ts";
import { SelectionWindows } from "../services/SelectionWindows.ts";

type Json = Record<string, unknown>;
type Kind = "shadow" | "treated" | "control" | "none";
type Window = { atMs: number; context: string; kind: Kind; selected: string[]; candidates: string[]; seen: string[] };

const OURS = ["kmp", "made"];
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
const mode = (raw: unknown): LearningMode | null => {
  try { return LearningMode.of(raw as string); } catch { return null; }
};

// Evaluación offline de L1 (spec §6), con las mismas ventanas que tool_bandit (SelectionWindows,
// compartida entre las dos proyecciones: una ventana sólo se cierra por un hecho de sesión cuyo
// occurredAt sea posterior o igual al de su apertura; una reapertura posterior no la cierra).
// Shadow: de las candidatas usadas (primera vez en la ventana), cuántas no estaban en la
// selección (miss), y el tamaño del conjunto completo (mínimo + candidatas) frente al que la
// selección habría expuesto (mínimo + seleccionadas), en tools y en bytes de esquema.
// Active: por grupo (tratado o control), decisiones, turnos y, de las tools de KMP y MADE,
// invocaciones, negativas y éxito a la primera (primera invocación de cada tool en la
// ventana). Las decisiones fallback (y, defensivamente, off) abren su ventana para que las
// siguientes se sigan atribuyendo bien, pero no se evalúan (regla del controlador: "no
// evaluada" aplica a learning_eval), y no aplican el 0 suave de tool_bandit: aquí no hay cierre.
export class LearningEvalProjection implements Projection {
  static readonly NAME = ProjectionName.of("learning_eval");
  static readonly VERSION = 1;
  static readonly OPEN_KEY = "open";
  readonly name = LearningEvalProjection.NAME;
  readonly version = LearningEvalProjection.VERSION;
  // session|<id> (la línea de /underpass-status) vive mientras la sesión tenga una ventana
  // abierta: al cerrarse, reabrirse sin decisión o abandonarse, se borra (estado acotado).
  readonly #windows = new SelectionWindows<Window>(LearningEvalProjection.OPEN_KEY, () => {},
    (state, stream) => state.delete(LearningEvalProjection.sessionKey(StreamId.of(stream).sessionId().value)));

  static contextKey(context: string): string { return `context|${context}`; }
  static sessionKey(sessionId: string): string { return `session|${sessionId}`; }
  static emptyGroup(): EvalGroupDto { return { decisions: 0, firstTryAttempted: 0, firstTrySucceeded: 0, turns: 0, invocations: 0, refused: 0 }; }

  apply(state: ProjectionState, e: StoredEvent): void {
    const r = e.record; const p = obj(r.payload.toValue());
    const opened = r.type.value === "tools.selected" && r.stream.isSession() ? this.#open(state, r.stream.sessionId().value, p, r.occurredAt.epochMs()) : null;
    this.#windows.visit(state, e, opened, (w) => {
      const key = LearningEvalProjection.contextKey(w.context);
      const x = state.get<LearningEvalDto>(key);
      if (x === undefined || w.kind === "none") return;
      if (r.type.value === "turn.completed") { if (w.kind !== "shadow") { x[w.kind].turns++; state.set(key, x); } return; }
      const tool = str(p.tool);
      if (r.type.value !== "tool.completed" || tool === null || !OURS.includes(str(p.server) ?? "")) return;
      const first = !w.seen.includes(tool);
      if (w.kind === "shadow") {
        if (!first || !w.candidates.includes(tool)) return;
        w.seen.push(tool);
        x.shadow.used++; if (!w.selected.includes(tool)) x.shadow.missed++;
      } else {
        if (first) w.seen.push(tool);
        const g = x[w.kind];
        g.invocations++;
        if (p.status === "refused") g.refused++;
        if (first) { g.firstTryAttempted++; if (p.status === "succeeded") g.firstTrySucceeded++; }
      }
      state.set(key, x);
    });
  }

  #open(state: ProjectionState, sessionId: string, p: Json, atMs: number): Window | null {
    const learningMode = mode(p.mode);
    let context: LearningContext;
    try { context = LearningContext.parse(p.context); } catch { return null; }
    const candidates = strings(p.candidates); const selected = strings(p.selected).filter((t) => candidates.includes(t)); const floor = strings(p.floor);
    const control = p.control === true;
    if (learningMode !== null) {
      const s: SessionLearningDto = { context: context.key, mode: learningMode.value, control, selected: selected.length, candidates: candidates.length };
      state.set(LearningEvalProjection.sessionKey(sessionId), s);
    }
    if (learningMode === null) return null;
    const kind: Kind = learningMode.equals(LearningMode.SHADOW) ? "shadow" : learningMode.equals(LearningMode.ACTIVE) ? (control ? "control" : "treated") : "none";
    if (kind === "none") return { atMs, context: context.key, kind, selected, candidates, seen: [] };
    const key = LearningEvalProjection.contextKey(context.key);
    const x = state.get<LearningEvalDto>(key) ?? { context: context.key, phase: context.phase.value, project: context.project.value,
      shadow: { decisions: 0, used: 0, missed: 0, fullTools: 0, exposedTools: 0, fullBytes: 0, exposedBytes: 0 },
      treated: LearningEvalProjection.emptyGroup(), control: LearningEvalProjection.emptyGroup() };
    if (kind === "shadow") {
      const bytes = obj(p.schemaBytes);
      x.shadow.decisions++;
      x.shadow.fullTools += floor.length + candidates.length; x.shadow.exposedTools += floor.length + selected.length;
      x.shadow.fullBytes += count(bytes.full); x.shadow.exposedBytes += count(bytes.exposed);
    } else x[kind].decisions++;
    state.set(key, x);
    return { atMs, context: context.key, kind, selected, candidates, seen: [] };
  }
}
