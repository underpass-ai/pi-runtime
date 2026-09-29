import type { EventId } from "../../domain/events/EventId.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import { ControlGroup } from "../../domain/learning/ControlGroup.ts";
import { LearningContext } from "../../domain/learning/LearningContext.ts";
import { LearningMode } from "../../domain/learning/LearningMode.ts";
import { SeededRandom } from "../../domain/learning/SeededRandom.ts";
import { SelectionFloor } from "../../domain/learning/SelectionFloor.ts";
import { SelectionSize } from "../../domain/learning/SelectionSize.ts";
import { SlidingBeta } from "../../domain/learning/SlidingBeta.ts";
import { ThompsonSelector } from "../../domain/learning/ThompsonSelector.ts";
import { ToolSelection } from "../../domain/learning/ToolSelection.ts";
import { ServerName } from "../../domain/mcp/ServerName.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Phase } from "../../domain/session/Phase.ts";
import type { PhaseToolSelection } from "../../domain/session/PhaseToolSelection.ts";
import type { TelemetryInstanceId } from "../../domain/telemetry/TelemetryInstanceId.ts";
import type { BanditArmDto } from "../dto/BanditArmDto.ts";
import type { LearningModeDto } from "../dto/LearningModeDto.ts";
import type { SelectionDto } from "../dto/SelectionDto.ts";
import type { ToolStatsDto } from "../dto/ToolStatsDto.ts";
import type { ProjectionStore } from "../ports/ProjectionStore.ts";
import { ToolBanditProjection } from "../projections/ToolBanditProjection.ts";
import { ToolStatsProjection } from "../projections/ToolStatsProjection.ts";
import type { KnownCatalogs } from "../services/KnownCatalogs.ts";
import type { LearningFactFactory } from "../services/LearningFactFactory.ts";
import type { RecordFact } from "./RecordFact.ts";

const names = (xs: readonly ToolName[]) => xs.map((x) => x.value);

// Decisión de L1 (spec §1–§4, §7): candidatas = lo que la fase permite (y el catálogo
// conocido ofrece) menos el mínimo fijo; Thompson con el event_id de tools.selected como
// semilla; control determinista en active. Registra tools.selected y responde. Si no puede
// decidir, registra y responde fallback; si ni siquiera puede registrar, responde fallback
// sin hecho. off no decide ni registra. Nunca lanza por el estado del bandit.
export class SelectTools {
  readonly #store: ProjectionStore; readonly #record: RecordFact; readonly #facts: LearningFactFactory; readonly #phases: PhaseToolSelection;
  readonly #catalogs: KnownCatalogs; readonly #project: TelemetryInstanceId | null; readonly #refresh: () => void;

  // project: el id HMAC de O1 (null si la clave de telemetría no está disponible: fallback sin
  // hecho). refresh: pone al día las proyecciones antes de leerlas (el runner del host).
  constructor(store: ProjectionStore, record: RecordFact, facts: LearningFactFactory, phases: PhaseToolSelection, catalogs: KnownCatalogs,
    project: TelemetryInstanceId | null, refresh: () => void = () => {}) {
    this.#store = store; this.#record = record; this.#facts = facts; this.#phases = phases; this.#catalogs = catalogs; this.#project = project; this.#refresh = refresh;
  }

  // deadline: el plazo de la extensión (spec §7). Si el reloj del host ya lo pasó al fijar el
  // hecho (tras poner al día las proyecciones, lo caro), Pi no aplicará la respuesta: fallback
  // con el conjunto completo y sin hecho. Carrera residual: una respuesta a tiempo aquí puede
  // llegar tarde a la extensión (transporte); ese hecho queda registrado y Pi no lo aplica.
  execute(session: SessionId, phase: Phase, deadline: Timestamp | null = null): SelectionDto {
    const allowed = this.#catalogs.available(this.#phases.allowed(phase));
    const floor = SelectionFloor.STANDARD.within(allowed); const candidates = SelectionFloor.STANDARD.candidates(allowed);
    const fallback: SelectionDto = { mode: "fallback", control: false, selected: names(candidates), floor: names(floor) };
    let bandit: Map<string, unknown>;
    try { this.#refresh(); bandit = this.#store.load(ToolBanditProjection.NAME); } catch { return fallback; }
    const setting = this.#setting(bandit);
    if (setting.mode.equals(LearningMode.OFF)) return { mode: "off", control: false, selected: [], floor: [] };
    if (this.#project === null) return fallback;
    const context = LearningContext.of(phase, this.#project);
    // El id del hecho se fija antes de muestrear: es la semilla del PRNG y del control.
    let slot: { id: EventId; at: Timestamp };
    try { slot = this.#facts.slot(session); } catch { return fallback; }
    if (deadline !== null && slot.at.epochMs() > deadline.epochMs()) return fallback;
    let selection: ToolSelection;
    try { selection = this.#decide(context, setting, bandit, candidates, floor, slot); }
    catch { selection = ToolSelection.of({ context, mode: LearningMode.FALLBACK, control: false, size: setting.size, candidates, selected: candidates, floor, seed: slot.id, schemaBytes: this.#bytes(floor, candidates, candidates) }); }
    try { this.#record.execute(this.#facts.toolsSelected(session, slot, selection)); } catch { return fallback; }
    return { mode: selection.mode.value as SelectionDto["mode"], control: selection.control, selected: names(selection.selected), floor: names(selection.floor) };
  }

  #decide(context: LearningContext, setting: { mode: LearningMode; size: SelectionSize }, bandit: Map<string, unknown>, candidates: ToolName[], floor: ToolName[],
    slot: { id: EventId; at: Timestamp }): ToolSelection {
    const stats = this.#store.load(ToolStatsProjection.NAME);
    const posterior = (tool: ToolName) => {
      const arm = SelectTools.#arm(bandit.get(ToolBanditProjection.armKey(context.key, tool.value)));
      const server = ServerName.owning(tool);
      const successes = server === null ? 0 : (stats.get(`tool:${server.value}:${tool.value}`) as ToolStatsDto | undefined)?.succeeded ?? 0;
      return { alpha: arm.alpha(successes), beta: arm.beta() };
    };
    const selected = ThompsonSelector.select(candidates, posterior, setting.size, SeededRandom.from(slot.id));
    const control = setting.mode.equals(LearningMode.ACTIVE) && ControlGroup.contains(slot.id);
    return ToolSelection.of({ context, mode: setting.mode, control, size: setting.size, candidates, selected, floor, seed: slot.id, schemaBytes: this.#bytes(floor, candidates, selected) });
  }

  #bytes(floor: ToolName[], candidates: ToolName[], selected: ToolName[]): { full: number; exposed: number } {
    const sum = (xs: ToolName[]) => xs.reduce((s, t) => s + this.#catalogs.bytesOf(t), 0);
    return { full: sum(floor) + sum(candidates), exposed: sum(floor) + sum(selected) };
  }

  // Un estado ilegible cuenta como vacío: la tool arranca con el prior neutral.
  static #arm(raw: unknown): SlidingBeta {
    try { return SlidingBeta.fromJson((raw as BanditArmDto | undefined)?.obs ?? []); } catch { return SlidingBeta.EMPTY; }
  }

  #setting(bandit: Map<string, unknown>): { mode: LearningMode; size: SelectionSize } {
    const dto = (bandit.get(ToolBanditProjection.MODE_KEY) as LearningModeDto | undefined) ?? ToolBanditProjection.DEFAULT_MODE;
    try { return { mode: LearningMode.setting(dto.mode), size: SelectionSize.of(dto.k) }; }
    catch { return { mode: LearningMode.DEFAULT, size: SelectionSize.DEFAULT }; }
  }
}
