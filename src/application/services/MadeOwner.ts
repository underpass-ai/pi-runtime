import type { MadeDecisionId } from "../../domain/made/MadeDecisionId.ts";
import { MadeDecision } from "../../domain/made/MadeDecision.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeGrantId } from "../../domain/made/MadeGrantId.ts";
import type { RevocationReason } from "../../domain/made/RevocationReason.ts";
import { TrustedHostId } from "../../domain/made/TrustedHostId.ts";
import { ToolName } from "../../domain/mcp/ToolName.ts";
import { ToolRefusal } from "../../domain/mcp/ToolRefusal.ts";
import type { ToolSuccess } from "../../domain/mcp/ToolSuccess.ts";
import type { McpConnection } from "../ports/McpConnection.ts";

const POLICY = ToolName.of("made_get_authorization_policy");
const DECISIONS = ToolName.of("made_list_authorization_decisions");
const ISSUE = ToolName.of("made_issue_authorization_grant");
const REVOKE = ToolName.of("made_revoke_authorization_grant");

// El host como dueño de la política de MADE en modo embebido (único principal, el trusted
// host): lee la política y las decisiones, emite y revoca grants. Nunca lo ve el modelo.
export class MadeOwner {
  readonly #connection: () => Promise<McpConnection>; #principal: TrustedHostId | null = null;
  constructor(connection: () => Promise<McpConnection>) { this.#connection = connection; }

  // El dueño de la política, que también es quien recibe los grants. Se lee una vez.
  async principal(): Promise<TrustedHostId> {
    if (this.#principal !== null) return this.#principal;
    const policy = (await this.#call(POLICY, {})).structured as { policy?: { owner?: { principal_id?: unknown } } } | null;
    this.#principal = TrustedHostId.of(policy?.policy?.owner?.principal_id as string);
    return this.#principal;
  }

  // La decisión exacta, pidiendo la página que empieza en ella; null si no está o no se puede leer.
  async decision(id: MadeDecisionId): Promise<MadeDecision | null> {
    try {
      const cursor = id.cursor();
      const page = (await this.#call(DECISIONS, cursor === null ? { limit: 1 } : { after_decision_id: cursor, limit: 1 })).structured as { decisions?: unknown[] } | null;
      const found = (page?.decisions ?? []).find((d) => (d as { decision_id?: unknown }).decision_id === id.value);
      return found === undefined ? null : MadeDecision.parse(found);
    } catch { return null; }
  }

  async issue(grant: MadeGrant): Promise<void> { await this.#call(ISSUE, grant.issueArguments(await this.principal())); }

  // Revocar lo ya revocado es un no-op en MADE; un grant que MADE no conoce (otro store) ya no autoriza nada.
  async revoke(grant: MadeGrantId, reason: RevocationReason): Promise<void> {
    try { await this.#call(REVOKE, { grant_id: grant.value, reason: reason.value }); }
    catch (e) { if (!(e instanceof ToolRefusal && e.code.value === "not_found")) throw e; }
  }

  async #call(tool: ToolName, args: Record<string, unknown>): Promise<ToolSuccess> {
    const outcome = await (await this.#connection()).call(tool, args);
    if (outcome instanceof ToolRefusal) throw outcome;
    return outcome;
  }
}
