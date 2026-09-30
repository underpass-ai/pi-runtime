import { ToolName } from "../mcp/ToolName.ts";
import { Phase } from "./Phase.ts";

const KMP_INTERACTIVE = ["kmp_guide", "kmp_wake", "kmp_ask", "kmp_time", "kmp_trace", "kmp_inspect", "kmp_relate", "kmp_write_memory", "kmp_relabel", "kmp_condense", "kmp_view_open", "kmp_view_get_state", "kmp_view_apply_intent"];
// Con made-mcp 0.9.0, además, listar las publicadas y leer una (sus pasos e instrucciones): en design
// para partir de una existente; en run, para saber qué pide cada paso antes de arrancarla.
const MADE_DESIGN = ["made_design_ceremony", "made_validate_ceremony_draft", "made_explain_ceremony_draft", "made_diff_ceremony_definitions", "made_publish_ceremony_definition", "made_list_contracts", "made_get_help",
  "made_list_ceremony_definitions", "made_get_ceremony_definition"];
// F3, determinado contra made-mcp 0.8.0 y comprobado igual en 0.9.0: arrancar una publicada (con ceremony_id: sin él, MADE
// sólo decide con alcance global y no lo admite), reclamar y completar cada paso host_callback y
// aplicar la transición habilitada hasta el terminal. get_ceremony_instance, para releer el estado.
const MADE_RUN = ["made_start_published_ceremony", "made_get_ceremony_instance", "made_claim_ceremony_step", "made_complete_ceremony_step", "made_apply_ceremony_transition"];

export class PhaseToolSelection {
  readonly #byPhase: Map<string, Set<string>>;
  private constructor(m: Map<string, Set<string>>) { this.#byPhase = m; }
  static standard(): PhaseToolSelection {
    return new PhaseToolSelection(new Map([
      [Phase.INTERACTIVE.value, new Set(KMP_INTERACTIVE)],
      [Phase.DESIGN.value, new Set([...KMP_INTERACTIVE, ...MADE_DESIGN])],
      [Phase.RUN.value, new Set([...KMP_INTERACTIVE, ...MADE_DESIGN, ...MADE_RUN])],
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
