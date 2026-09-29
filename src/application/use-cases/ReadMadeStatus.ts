import type { SessionId } from "../../domain/events/SessionId.ts";
import type { SessionMadeDto } from "../dto/SessionMadeDto.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";
import { MadeCeremonyMapper } from "../mappers/MadeCeremonyMapper.ts";

// La línea `made:` de /underpass-status y, desde F3, las instancias que arrancó la sesión: sólo el
// stream de la sesión y el del host.
export class ReadMadeStatus {
  readonly #events: EventStore; readonly #clock: Clock;
  constructor(events: EventStore, clock: Clock) { this.#events = events; this.#clock = clock; }
  execute(session: SessionId): SessionMadeDto {
    const ledger = MadeGrantLedger.forSession(this.#events, session); const now = this.#clock.now();
    return { activeGrants: ledger.live(session, now).length, confirmations: ledger.confirmations(session), ceremonies: MadeCeremonyMapper.forSession(ledger, session, now) };
  }
}
