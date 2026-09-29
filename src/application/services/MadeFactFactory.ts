import type { Actor } from "../../domain/events/Actor.ts";
import { EventAbout } from "../../domain/events/EventAbout.ts";
import { EventId } from "../../domain/events/EventId.ts";
import { EventType } from "../../domain/events/EventType.ts";
import { Fact } from "../../domain/events/Fact.ts";
import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { TypeVersion } from "../../domain/events/TypeVersion.ts";
import type { CeremonyEndReason } from "../../domain/made/CeremonyEndReason.ts";
import type { CeremonyId } from "../../domain/made/CeremonyId.ts";
import type { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeGrantId } from "../../domain/made/MadeGrantId.ts";
import type { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import type { RevocationReason } from "../../domain/made/RevocationReason.ts";
import type { StartedCeremony } from "../../domain/made/StartedCeremony.ts";
import { CanonicalJson } from "../../domain/shared/CanonicalJson.ts";
import type { Clock } from "../ports/Clock.ts";

const ISSUED = EventType.of("made.grant_issued");
const REVOKED = EventType.of("made.grant_revoked");
const CONFIRMATION = EventType.of("made.confirmation");
const STARTED = EventType.of("made.ceremony_started");
const ENDED = EventType.of("made.ceremony_ended");
// El id de la instancia lo elige el modelo: en el id del hecho va su digest, nunca el texto.
const aboutCeremony = (prefix: string, id: CeremonyId) => EventAbout.of(`${prefix}.${id.fingerprint()}`);

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

  // F3 (stream de la sesión): esta sesión arrancó esa instancia con una confirmación aceptada.
  ceremonyStarted(started: StartedCeremony): Fact {
    const stream = StreamId.session(started.session);
    return Fact.of({ id: EventId.derive(stream, STARTED, aboutCeremony("ceremony", started.ceremony)), stream, type: STARTED, typeVersion: TypeVersion.V1,
      occurredAt: started.startedAt, actor: this.#actor, payload: CanonicalJson.of(started.toFactPayload()) });
  }

  // F3 (stream de la sesión): la instancia que arrancó llegó a un terminal; sus grants se revocan.
  ceremonyEnded(session: SessionId, ceremony: CeremonyId, reason: CeremonyEndReason): Fact {
    const stream = StreamId.session(session);
    return Fact.of({ id: EventId.derive(stream, ENDED, aboutCeremony("ended", ceremony)), stream, type: ENDED, typeVersion: TypeVersion.V1,
      occurredAt: this.#clock.now(), actor: this.#actor, payload: CanonicalJson.of({ ceremonyId: ceremony.value, endReason: reason.value }) });
  }
}
