import { DomainError } from "../shared/DomainError.ts";
import type { SessionId } from "../events/SessionId.ts";
import { Timestamp } from "../events/Timestamp.ts";
import { MadeAction } from "./MadeAction.ts";
import { MadeActionClass } from "./MadeActionClass.ts";
import { GrantSequence } from "./GrantSequence.ts";
import { MadeGrantId } from "./MadeGrantId.ts";
import { MadeScope } from "./MadeScope.ts";
import type { TrustedHostId } from "./TrustedHostId.ts";

type Props = { id: MadeGrantId; session: SessionId; action: MadeAction; scope: MadeScope; actionClass: MadeActionClass; validFrom: Timestamp; validUntil: Timestamp };

// Un grant exacto del host (S3a §2): una acción, un alcance, el trusted host como emisor y
// beneficiario, sin delegación, con vigencia acotada por su clase.
export class MadeGrant {
  readonly id: MadeGrantId; readonly session: SessionId; readonly action: MadeAction; readonly scope: MadeScope;
  readonly actionClass: MadeActionClass; readonly validFrom: Timestamp; readonly validUntil: Timestamp;
  private constructor(p: Props) {
    this.id = p.id; this.session = p.session; this.action = p.action; this.scope = p.scope; this.actionClass = p.actionClass; this.validFrom = p.validFrom; this.validUntil = p.validUntil;
  }

  static issue(session: SessionId, action: MadeAction, scope: MadeScope, actionClass: MadeActionClass, now: Timestamp, sequence: GrantSequence = GrantSequence.FIRST): MadeGrant {
    return new MadeGrant({ id: MadeGrantId.derive(session, action, scope, now, sequence), session, action, scope, actionClass, validFrom: now,
      validUntil: Timestamp.fromEpochMs(now.epochMs() + actionClass.lifetimeMs()) });
  }

  // Desde el payload de made.grant_issued; validFrom es el occurredAt del hecho.
  static fromFact(session: SessionId, payload: unknown, validFrom: Timestamp): MadeGrant {
    if (typeof payload !== "object" || payload === null) throw DomainError.because("grant payload must be an object");
    const p = payload as Record<string, unknown>;
    return new MadeGrant({ id: MadeGrantId.of(p.grantId as string), session, action: MadeAction.of(p.action as string), scope: MadeScope.parse(p.scope),
      actionClass: MadeActionClass.of(p.class as string), validFrom, validUntil: Timestamp.parse(p.validUntil as string) });
  }

  expired(now: Timestamp): boolean { return now.epochMs() >= this.validUntil.epochMs(); }

  // Argumentos de made_issue_authorization_grant (el dueño no pasa padre).
  issueArguments(grantee: TrustedHostId): Record<string, unknown> {
    return { grant_id: this.id.value, grantee_id: grantee.value, actions: [this.action.value], scope: this.scope.toJson(),
      valid_from: this.validFrom.value, valid_until: this.validUntil.value, delegation_depth: 0 };
  }

  // Payload de made.grant_issued (S3a §4).
  toFactPayload(): Record<string, unknown> {
    return { grantId: this.id.value, action: this.action.value, scope: this.scope.toJson(), validUntil: this.validUntil.value, class: this.actionClass.value };
  }
}
