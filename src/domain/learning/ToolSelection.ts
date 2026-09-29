import { DomainError } from "../shared/DomainError.ts";
import type { EventId } from "../events/EventId.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import type { LearningContext } from "./LearningContext.ts";
import { LearningMode } from "./LearningMode.ts";
import type { SelectionSize } from "./SelectionSize.ts";

type Props = {
  context: LearningContext; mode: LearningMode; control: boolean; size: SelectionSize; candidates: ToolName[]; selected: ToolName[];
  floor: ToolName[]; seed: EventId; schemaBytes: { full: number; exposed: number };
};
const names = (xs: ToolName[]) => xs.map((x) => x.value);
const bytes = (n: number) => Number.isInteger(n) && n >= 0;

// Una decisión de L1 (spec §5): sólo nombres de tools (públicos del catálogo) y números.
// `selected` va en el orden del muestreo; candidatas y mínimo, por nombre. `schemaBytes`
// (tamaño de esquema del conjunto completo y del expuesto por la selección) alimenta el
// ahorro en bytes de learning_eval.
export class ToolSelection {
  readonly context: LearningContext; readonly mode: LearningMode; readonly control: boolean; readonly size: SelectionSize;
  readonly candidates: readonly ToolName[]; readonly selected: readonly ToolName[]; readonly floor: readonly ToolName[];
  readonly seed: EventId; readonly schemaBytes: { readonly full: number; readonly exposed: number };
  private constructor(p: Props) {
    this.context = p.context; this.mode = p.mode; this.control = p.control; this.size = p.size; this.candidates = p.candidates;
    this.selected = p.selected; this.floor = p.floor; this.seed = p.seed; this.schemaBytes = p.schemaBytes;
  }

  static of(p: Props): ToolSelection {
    if (p.mode.equals(LearningMode.OFF)) throw DomainError.because("an off learning mode makes no selection");
    if (p.control && !p.mode.equals(LearningMode.ACTIVE)) throw DomainError.because("only active decisions have a control group");
    if (!p.selected.every((s) => p.candidates.some((c) => c.equals(s)))) throw DomainError.because("selected tools must be candidates");
    if (p.floor.some((f) => p.candidates.some((c) => c.equals(f)))) throw DomainError.because("floor tools are never candidates");
    if (!bytes(p.schemaBytes.full) || !bytes(p.schemaBytes.exposed)) throw DomainError.because("schema bytes must be non-negative integers");
    return new ToolSelection({ ...p, candidates: [...p.candidates], selected: [...p.selected], floor: [...p.floor] });
  }

  // Sólo una decisión active fuera del grupo de control reduce el conjunto de la fase.
  narrows(): boolean { return this.mode.equals(LearningMode.ACTIVE) && !this.control; }

  toPayload(): Record<string, unknown> {
    return {
      context: this.context.toJson(), mode: this.mode.value, control: this.control, k: this.size.value, candidates: names([...this.candidates]),
      selected: names([...this.selected]), floor: names([...this.floor]), seed: this.seed.value, schemaBytes: { full: this.schemaBytes.full, exposed: this.schemaBytes.exposed },
    };
  }
}
