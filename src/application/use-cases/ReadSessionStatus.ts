import type { SessionId } from "../../domain/events/SessionId.ts";
import { StreamId } from "../../domain/events/StreamId.ts";
import { StreamVerifier } from "../../domain/events/StreamVerifier.ts";
import type { SessionStatusDto } from "../dto/SessionStatusDto.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { ReadSessionSummary } from "./ReadSessionSummary.ts";

// Sólo verifica el stream de la sesión pedida, no el log entero: es barato
// y es lo que /underpass-status necesita.
export class ReadSessionStatus {
  readonly #events: EventStore; readonly #summaries: ReadSessionSummary;
  constructor(events: EventStore, summaries: ReadSessionSummary) { this.#events = events; this.#summaries = summaries; }

  execute(id: SessionId): SessionStatusDto {
    const summary = this.#summaries.execute(id);
    const verification = StreamVerifier.verify(this.#events.readStream(StreamId.session(id)));
    return { summary, logPosition: this.#events.lastPosition().value, sessionChainIntact: verification.kind !== "broken" };
  }
}
