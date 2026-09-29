import type { ToolName } from "../mcp/ToolName.ts";
import type { Phase } from "../session/Phase.ts";
import { PhaseToolSelection } from "../session/PhaseToolSelection.ts";
import { MadeActionClass } from "./MadeActionClass.ts";

// Tabla cerrada de S3a §1, por nombre de tool sin el prefijo `made_`.
const AUTO = new Set([
  "get_status", "discover_capabilities", "get_help", "list_contracts", "list_ceremony_instances", "get_ceremony_instance", "get_ceremony_transcript",
  "read_ceremony_events", "get_artifact", "list_artifacts", "read_artifact_chunk", "get_budget_report", "get_metrics", "explain_ceremony_draft",
  "validate_ceremony_draft", "diff_ceremony_definitions", "design_ceremony",
]);
const NEVER = new Set(["issue_authorization_grant", "revoke_authorization_grant", "approve_authorization_operation", "get_authorization_policy", "list_authorization_decisions"]);

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

  // La clase si el host puede conceder la tool en esta fase; null si nunca o si la fase no la expone.
  admits(tool: ToolName, phase: Phase | null): MadeActionClass | null {
    const c = this.classify(tool);
    if (c.equals(MadeActionClass.NEVER) || phase === null || !this.#phases.exposes(phase, tool)) return null;
    return c;
  }
}
