import type { Actor } from "../../domain/events/Actor.ts";
import { EventAbout } from "../../domain/events/EventAbout.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { Fact } from "../../domain/events/Fact.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import type { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeGrantId } from "../../domain/made/MadeGrantId.ts";
import type { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import type { RevocationReason } from "../../domain/made/RevocationReason.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import type { Clock } from "../ports/Clock.ts";

const ISSUED = EventType.of("made.grant_issued");
const REVOKED = EventType.of("made.grant_revoked");
const CONFIRMATION = EventType.of("made.confirmation");

// Hechos de auditoría de S3a §4, todos v1. Sólo nombres de acción, alcances de MADE (tipo y
// nombre, versión o id), ids de grant y sesión, instantes y resultados; nunca argumentos.
// Los ids son deterministas por grant o por token: registrar dos veces lo mismo es idempotente.
export class MadeFactFactory {
  readonly #clock: Clock; readonly #actor: Actor;
  constructor(clock: Clock, actor: Actor) { this.#clock = clock; this.#actor = actor; }

  grantIssued(grant: MadeGrant): Fact {
    const stream = StreamId.session(grant.session);
    return Fact.of({ id: EventId.derive(stream, ISSUED, EventAbout.of(`grant.${grant.id.value}`)), stream, type: ISSUED, typeVersion: TypeVersion.V1,
      occurredAt: grant.validFrom, actor: this.#actor, payload: CanonicalJson.of(grant.toFactPayload()) });
  }

  // En el stream del host: la sesión puede estar ya cerrada (session.closed no admite más hechos).
  grantRevoked(grant: MadeGrantId, session: SessionId, reason: RevocationReason): Fact {
    return Fact.of({ id: EventId.derive(StreamId.HOST, REVOKED, EventAbout.of(`revoke.${grant.value}`)), stream: StreamId.HOST, type: REVOKED, typeVersion: TypeVersion.V1,
      occurredAt: this.#clock.now(), actor: this.#actor, payload: CanonicalJson.of({ grantId: grant.value, session: session.value, reason: reason.value }) });
  }

  confirmation(pending: PendingConfirmation, outcome: ConfirmationOutcome): Fact {
    const stream = StreamId.session(pending.session);
    return Fact.of({ id: EventId.derive(stream, CONFIRMATION, EventAbout.of(`confirm.${pending.token.value}`)), stream, type: CONFIRMATION, typeVersion: TypeVersion.V1,
      occurredAt: this.#clock.now(), actor: this.#actor, payload: CanonicalJson.of({ action: pending.action.value, scopeSummary: pending.scopeSummary(), outcome: outcome.value }) });
  }
}
