import { ToolName } from "../mcp/ToolName.ts";
import { Phase } from "./Phase.ts";

const KMP_INTERACTIVE = ["kmp_guide", "kmp_wake", "kmp_ask", "kmp_time", "kmp_trace", "kmp_inspect", "kmp_relate", "kmp_write_memory", "kmp_relabel", "kmp_condense", "kmp_view_open", "kmp_view_get_state", "kmp_view_apply_intent"];
const MADE_DESIGN = ["made_design_ceremony", "made_validate_ceremony_draft", "made_explain_ceremony_draft", "made_diff_ceremony_definitions", "made_publish_ceremony_definition", "made_list_contracts", "made_get_help"];

export class PhaseToolSelection {
  readonly #byPhase: Map<string, Set<string>>;
  private constructor(m: Map<string, Set<string>>) { this.#byPhase = m; }
  static standard(): PhaseToolSelection {
    return new PhaseToolSelection(new Map([
      [Phase.INTERACTIVE.value, new Set(KMP_INTERACTIVE)],
      [Phase.DESIGN.value, new Set([...KMP_INTERACTIVE, ...MADE_DESIGN])],
    ]));
  }
  // Otra tabla de fases (la simulación de L1 usa candidatas sintéticas).
  static of(entries: [Phase, string[]][]): PhaseToolSelection {
    return new PhaseToolSelection(new Map(entries.map(([phase, names]) => [phase.value, new Set(names.map((n) => ToolName.of(n).value))])));
  }
  // Lo que la fase permite de KMP y MADE, por nombre (candidatas de L1 antes de quitar el mínimo).
  allowed(phase: Phase): ToolName[] { return [...(this.#byPhase.get(phase.value) ?? [])].sort().map((n) => ToolName.of(n)); }
  // Si la fase expone esta tool (S3a: la fase manda sobre lo que el host concede).
  exposes(phase: Phase, tool: ToolName): boolean { return this.#byPhase.get(phase.value)?.has(tool.value) ?? false; }
  select(phase: Phase, registered: ToolName[], foreign: string[]): string[] {
    const wanted = this.#byPhase.get(phase.value)!;
    return [...foreign, ...registered.filter((t) => wanted.has(t.value)).map((t) => t.value)];
  }
}
