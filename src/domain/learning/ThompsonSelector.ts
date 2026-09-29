import type { ToolName } from "../mcp/ToolName.ts";
import type { SeededRandom } from "./SeededRandom.ts";
import type { SelectionSize } from "./SelectionSize.ts";

// Thompson Sampling (spec §2): una muestra Beta(α, β) por candidata, en orden de nombre
// para que el resultado no dependa del orden de entrada; se ordena por la muestra (mayor
// primero, empates por nombre) y se toman las k primeras. Con k o menos candidatas se
// exponen todas, por nombre.
export class ThompsonSelector {
  private constructor() {}

  static select(candidates: ToolName[], posterior: (tool: ToolName) => { alpha: number; beta: number }, k: SelectionSize, random: SeededRandom): ToolName[] {
    const byName = [...candidates].sort((a, b) => a.value.localeCompare(b.value));
    if (byName.length <= k.value) return byName;
    const sampled = byName.map((tool) => { const p = posterior(tool); return { tool, value: random.beta(p.alpha, p.beta) }; });
    sampled.sort((a, b) => b.value - a.value || a.tool.value.localeCompare(b.tool.value));
    return sampled.slice(0, k.value).map((s) => s.tool);
  }
}
