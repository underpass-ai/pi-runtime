import type { MadeCeremonyDto } from "../dto/MadeCeremonyDto.ts";
import { MadeCeremonyMapper } from "../mappers/MadeCeremonyMapper.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";

// `underpass made ceremonies` (F3): las instancias que arrancó cada sesión y sus grants.
export class ListMadeCeremonies {
  readonly #events: EventStore; readonly #clock: Clock;
  constructor(events: EventStore, clock: Clock) { this.#events = events; this.#clock = clock; }

  execute(): MadeCeremonyDto[] {
    const ledger = MadeGrantLedger.read(this.#events); const now = this.#clock.now();
    return ledger.sessionsWithCeremonies().flatMap((s) => MadeCeremonyMapper.forSession(ledger, s, now));
  }
}
