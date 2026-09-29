import type { MadeGrantRowDto } from "../dto/MadeGrantRowDto.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EventStore } from "../ports/EventStore.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";

// `underpass made grants`: los grants que el host registró en el log, con su estado de ahora.
export class ListMadeGrants {
  readonly #events: EventStore; readonly #clock: Clock;
  constructor(events: EventStore, clock: Clock) { this.#events = events; this.#clock = clock; }

  execute(): MadeGrantRowDto[] {
    const ledger = MadeGrantLedger.read(this.#events); const now = this.#clock.now();
    return ledger.grants().map((g) => ({ grantId: g.id.value, session: g.session.value, action: g.action.value, scope: g.scope.summary(), class: g.actionClass.value,
      validUntil: g.validUntil.value, state: ledger.state(g, now), reason: ledger.revocation(g) }));
  }
}
