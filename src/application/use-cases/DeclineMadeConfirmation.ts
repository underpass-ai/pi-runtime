import type { SessionId } from "../../domain/events/SessionId.ts";
import type { ConfirmationOutcome } from "../../domain/made/ConfirmationOutcome.ts";
import type { ConfirmationToken } from "../../domain/made/ConfirmationToken.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import type { PendingConfirmations } from "../services/PendingConfirmations.ts";
import type { RecordFact } from "./RecordFact.ts";

// S3a §3: el usuario rechazó la confirmación o Pi no tiene UI para pedirla. El host anula el
// token y lo registra como made.confirmation. Un token desconocido, ajeno o caducado no registra nada.
export class DeclineMadeConfirmation {
  readonly #confirmations: PendingConfirmations; readonly #record: RecordFact; readonly #facts: MadeFactFactory;
  constructor(confirmations: PendingConfirmations, record: RecordFact, facts: MadeFactFactory) { this.#confirmations = confirmations; this.#record = record; this.#facts = facts; }

  execute(session: SessionId, token: ConfirmationToken, outcome: ConfirmationOutcome): { recorded: boolean } {
    const pending = this.#confirmations.settle(token, session);
    if (pending === null) return { recorded: false };
    this.#record.execute(this.#facts.confirmation(pending, outcome));
    return { recorded: true };
  }
}
