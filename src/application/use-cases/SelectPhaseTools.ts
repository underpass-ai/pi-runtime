import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Phase } from "../../domain/session/Phase.ts";
import type { PhaseToolSelection } from "../../domain/session/PhaseToolSelection.ts";

export class SelectPhaseTools {
  readonly #selection: PhaseToolSelection;
  constructor(selection: PhaseToolSelection) { this.#selection = selection; }
  execute(phase: Phase, registered: ToolName[], foreign: string[]): string[] { return this.#selection.select(phase, registered, foreign); }
}
