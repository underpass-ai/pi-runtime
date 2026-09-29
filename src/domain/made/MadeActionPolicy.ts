import type { ToolName } from "../mcp/ToolName.ts";
import type { Phase } from "../session/Phase.ts";
import { PhaseToolSelection } from "../session/PhaseToolSelection.ts";
import type { MadeAction } from "./MadeAction.ts";
import { MadeActionClass } from "./MadeActionClass.ts";
import type { MadeScope } from "./MadeScope.ts";

// Tabla cerrada de S3a §1, por nombre de tool sin el prefijo `made_`.
const AUTO = new Set([
  "get_status", "discover_capabilities", "get_help", "list_contracts", "list_ceremony_instances", "get_ceremony_instance", "get_ceremony_transcript",
  "read_ceremony_events", "get_artifact", "list_artifacts", "read_artifact_chunk", "get_budget_report", "get_metrics", "explain_ceremony_draft",
  "validate_ceremony_draft", "diff_ceremony_definitions", "design_ceremony",
]);
const NEVER = new Set(["issue_authorization_grant", "revoke_authorization_grant", "approve_authorization_operation", "get_authorization_policy", "list_authorization_decisions"]);
// S3a §0.4: las únicas acciones que MADE 0.8.0 sólo autoriza con alcance global y que el host
// concede así. Cualquier otra decisión con alcance global se queda en la denegación original.
const GLOBAL_EXCEPTION = new Set(["design_ceremony", "list_contracts", "diff_ceremony_definitions"]);

// F3: las escrituras de ejecución sobre una instancia. Siguen siendo confirm, salvo sobre una
// instancia que arrancó la propia sesión con una confirmación: ahí el host las concede solas, con
// un grant de alcance a esa instancia. Son las que la fase run expone (determinado contra
// made-mcp 0.8.0: complete no pide grant propio, pero se incluye por si una versión lo exige).
const INSTANCE_EXECUTION = new Set(["claim_ceremony_step", "complete_ceremony_step", "apply_ceremony_transition"]);
const START = "made_start_published_ceremony";

// Qué puede conceder el host para una tool de MADE. Lo desconocido es confirm; lo que no es de
// MADE, never. La fase manda: nada se concede si la fase actual no expone la tool.
export class MadeActionPolicy {
  readonly #phases: PhaseToolSelection;
  private constructor(phases: PhaseToolSelection) { this.#phases = phases; }

  static of(phases: PhaseToolSelection): MadeActionPolicy { return new MadeActionPolicy(phases); }
  static standard(): MadeActionPolicy { return new MadeActionPolicy(PhaseToolSelection.standard()); }

  classify(tool: ToolName): MadeActionClass {
    if (!tool.hasPrefix("made_")) return MadeActionClass.NEVER;
    const action = tool.value.slice("made_".length);
    if (NEVER.has(action)) return MadeActionClass.NEVER;
    return AUTO.has(action) ? MadeActionClass.AUTO : MadeActionClass.CONFIRM;
  }

  // Si el catálogo que ve Pi puede llevar la tool: nunca las never (sólo el host, como dueño).
  exposable(tool: ToolName): boolean { return !this.classify(tool).equals(MadeActionClass.NEVER); }

  // Si el host puede emitir un grant con este alcance para esta acción: el alcance global, sólo
  // para la excepción de §0.4.
  grantable(action: MadeAction, scope: MadeScope): boolean { return scope.kind !== "global" || GLOBAL_EXCEPTION.has(action.value); }

  // Si la acción es una escritura de ejecución sobre una instancia (F3).
  executesInstance(action: MadeAction): boolean { return INSTANCE_EXECUTION.has(action.value); }

  // Si la tool es una escritura de ejecución sobre una instancia (lo que la fase run concede sola
  // sobre una instancia propia): la tool llamada y la acción decidida tienen que serlo las dos.
  executesInstanceTool(tool: ToolName): boolean { return tool.hasPrefix("made_") && INSTANCE_EXECUTION.has(tool.value.slice("made_".length)); }

  // Si la tool arranca una ceremonia publicada: la única confirmación de la fase run.
  startsCeremony(tool: ToolName): boolean { return tool.value === START; }

  // Si el host debe retener la llamada sin llevarla a MADE: una escritura de ejecución fuera de
  // una fase que la exponga. Así un grant de instancia vivo nunca se usa fuera de run.
  withheld(tool: ToolName, phase: Phase | null): boolean {
    if (!this.executesInstanceTool(tool)) return false;
    return phase === null || !this.#phases.exposes(phase, tool);
  }

  // La clase si el host puede conceder la tool en esta fase; null si nunca o si la fase no la expone.
  admits(tool: ToolName, phase: Phase | null): MadeActionClass | null {
    const c = this.classify(tool);
    if (c.equals(MadeActionClass.NEVER) || phase === null || !this.#phases.exposes(phase, tool)) return null;
    return c;
  }
}
