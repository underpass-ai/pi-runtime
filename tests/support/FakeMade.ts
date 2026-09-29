import { createHash } from "node:crypto";
import type { McpConnection } from "../../src/application/ports/McpConnection.ts";
import { SemVer } from "../../src/domain/distribution/SemVer.ts";
import { ProtocolVersion } from "../../src/domain/mcp/ProtocolVersion.ts";
import { RefusalCode } from "../../src/domain/mcp/RefusalCode.ts";
import { ServerIdentity } from "../../src/domain/mcp/ServerIdentity.ts";
import { ServerName } from "../../src/domain/mcp/ServerName.ts";
import type { ToolCatalog } from "../../src/domain/mcp/ToolCatalog.ts";
import type { ToolName } from "../../src/domain/mcp/ToolName.ts";
import type { ToolOutcome } from "../../src/domain/mcp/ToolOutcome.ts";
import { ToolRefusal } from "../../src/domain/mcp/ToolRefusal.ts";
import { ToolSuccess } from "../../src/domain/mcp/ToolSuccess.ts";

type Grant = { grant_id: string; actions: string[]; scope: Record<string, unknown>; valid_from: string; valid_until?: string; grantee_id: string; delegation_depth: number };
const canon = (o: unknown) => JSON.stringify(o, Object.keys(o as object).sort());
const refuse = (code: string, message: string) => ToolRefusal.of(RefusalCode.of(code), message, false);

// MADE 0.8.0 en modo embebido, en memoria y sólo en lo que S3a toca: un único principal dueño
// de la política; cada tool de negocio exige un grant de su acción y su alcance (definition si
// lleva `definition_yaml` con `name:`/`version:`, global si no) y, si no lo hay, deniega con la
// decisión registrada, que se lee con made_list_authorization_decisions (ids ordenados, cursor exclusivo).
export class FakeMade implements McpConnection {
  readonly server = ServerName.MADE; readonly identity = ServerIdentity.of("made-mcp", SemVer.of("0.8.0")); readonly protocol = ProtocolVersion.MCP_2024_11_05;
  readonly owner = "made-local-host-test";
  readonly grants = new Map<string, Grant>(); readonly revoked = new Set<string>(); readonly calls: string[] = [];
  readonly #decisions = new Map<string, Record<string, unknown>>(); #n = 0;
  now: () => number; failIssue = false; failDecisions = false; failRevoke = false;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  catalog(): Promise<ToolCatalog> { throw new Error("not needed"); }
  onExit(): void {}
  async close(): Promise<void> {}

  async call(tool: ToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
    this.calls.push(tool.value);
    switch (tool.value) {
      case "made_get_authorization_policy":
        return ToolSuccess.of({ policy: { owner: { principal_id: this.owner, kind: "trusted_host" }, grants: [...this.grants.values()], revocations: [...this.revoked] } }, "");
      case "made_list_authorization_decisions": {
        if (this.failDecisions) return refuse("unavailable", "store busy");
        const after = (args.after_decision_id as string | undefined) ?? "";
        const page = [...this.#decisions.keys()].sort().filter((id) => id > after).slice(0, Number(args.limit ?? 100)).map((id) => this.#decisions.get(id));
        return ToolSuccess.of({ decisions: page, next_after_decision_id: null }, "");
      }
      case "made_issue_authorization_grant": {
        if (this.failIssue) return refuse("unavailable", "store busy");
        const g = args as unknown as Grant; const existing = this.grants.get(g.grant_id);
        if (existing !== undefined) return canon(existing) === canon(g) ? ToolSuccess.of({ existing: true }, "") : refuse("conflict", "conflict: authorization_grant was changed by someone else first");
        this.grants.set(g.grant_id, g);
        return ToolSuccess.of({ existing: false }, "");
      }
      case "made_revoke_authorization_grant": {
        if (this.failRevoke) return refuse("unavailable", "store busy");
        const id = args.grant_id as string;
        if (!this.grants.has(id)) return refuse("not_found", "not found: authorization_grant");
        const existing = this.revoked.has(id); this.revoked.add(id);
        return ToolSuccess.of({ existing }, "");
      }
      default: return this.#business(tool.value, args);
    }
  }

  // Grants vigentes (sin revocar y dentro de su vigencia) que cubren una acción y un alcance.
  live(action: string, scope: Record<string, unknown>): Grant[] {
    const now = this.now();
    return [...this.grants.values()].filter((g) => !this.revoked.has(g.grant_id) && g.actions.includes(action) && JSON.stringify(g.scope) === JSON.stringify(scope)
      && Date.parse(g.valid_from) <= now && (g.valid_until === undefined || now < Date.parse(g.valid_until)));
  }

  #business(tool: string, args: Record<string, unknown>): ToolOutcome {
    const action = tool.replace(/^made_/, "");
    const yaml = typeof args.definition_yaml === "string" ? args.definition_yaml : null;
    const name = yaml === null ? null : /^name: (.+)$/m.exec(yaml)?.[1] ?? null;
    const version = yaml === null ? null : /^version: "?([^"\n]+)"?$/m.exec(yaml)?.[1] ?? null;
    const scope = name === null ? { kind: "global" } : { kind: "definition", name, version };
    if (this.live(action, scope).length > 0) return ToolSuccess.of({ tool, ok: true }, `${tool} ok`);
    const id = createHash("sha256").update(`decision-${this.#n++}`).digest("hex");
    this.#decisions.set(id, { decision_id: id, action, scope, outcome: "deny", denial_reason: "no_matching_grant", principal: { principal_id: this.owner } });
    return refuse("refused", `authorization decision ${id} denied the operation`);
  }
}
