import { DomainError } from "../shared/DomainError.ts";
import { MadeAction } from "./MadeAction.ts";
import { MadeDecisionId } from "./MadeDecisionId.ts";
import { MadeScope } from "./MadeScope.ts";

// Una decisión de made_list_authorization_decisions: sólo lo que el host necesita.
export class MadeDecision {
  readonly id: MadeDecisionId; readonly action: MadeAction; readonly scope: MadeScope; readonly #denied: boolean;
  private constructor(id: MadeDecisionId, action: MadeAction, scope: MadeScope, denied: boolean) { this.id = id; this.action = action; this.scope = scope; this.#denied = denied; }

  static parse(raw: unknown): MadeDecision {
    if (typeof raw !== "object" || raw === null) throw DomainError.because("MADE decision must be an object");
    const o = raw as Record<string, unknown>;
    return new MadeDecision(MadeDecisionId.of(o.decision_id as string), MadeAction.of(o.action as string), MadeScope.parse(o.scope), o.outcome === "deny");
  }

  denied(): boolean { return this.#denied; }
}
