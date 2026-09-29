import type { SessionId } from "../events/SessionId.ts";
import { Timestamp } from "../events/Timestamp.ts";
import type { ToolName } from "../mcp/ToolName.ts";
import type { CallDigest } from "./CallDigest.ts";
import type { ConfirmationToken } from "./ConfirmationToken.ts";
import type { MadeAction } from "./MadeAction.ts";
import type { MadeScope } from "./MadeScope.ts";

const TTL_MS = 120_000;

type Props = { token: ConfirmationToken; session: SessionId; tool: ToolName; digest: CallDigest; action: MadeAction; scope: MadeScope; expiresAt: Timestamp };

// Una confirmación pedida y aún sin responder (S3a §3): un solo uso, 2 minutos, ligada a la
// llamada exacta. Lleva la acción y el alcance de la decisión que la originó.
export class PendingConfirmation {
  readonly token: ConfirmationToken; readonly session: SessionId; readonly tool: ToolName; readonly digest: CallDigest;
  readonly action: MadeAction; readonly scope: MadeScope; readonly expiresAt: Timestamp;
  private constructor(p: Props) { this.token = p.token; this.session = p.session; this.tool = p.tool; this.digest = p.digest; this.action = p.action; this.scope = p.scope; this.expiresAt = p.expiresAt; }

  static readonly TTL_MS = TTL_MS;

  static open(token: ConfirmationToken, session: SessionId, tool: ToolName, digest: CallDigest, action: MadeAction, scope: MadeScope, now: Timestamp): PendingConfirmation {
    return new PendingConfirmation({ token, session, tool, digest, action, scope, expiresAt: Timestamp.fromEpochMs(now.epochMs() + TTL_MS) });
  }

  expired(now: Timestamp): boolean { return now.epochMs() >= this.expiresAt.epochMs(); }
  // La llamada que la redime es la misma que la pidió, y a tiempo.
  matches(session: SessionId, tool: ToolName, digest: CallDigest, now: Timestamp): boolean {
    return this.session.equals(session) && this.tool.equals(tool) && this.digest.equals(digest) && !this.expired(now);
  }
  scopeSummary(): string { return this.scope.summary(); }
  scopeLabel(): string { return this.scope.label(); }
}
