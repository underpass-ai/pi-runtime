import type { SessionId } from "../../domain/events/SessionId.ts";
import type { CallDigest } from "../../domain/made/CallDigest.ts";
import { ConfirmationToken } from "../../domain/made/ConfirmationToken.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";
import { PendingConfirmation } from "../../domain/made/PendingConfirmation.ts";
import type { ToolName } from "../../domain/mcp/ToolName.ts";
import type { Clock } from "../ports/Clock.ts";
import type { EntropySource } from "../ports/EntropySource.ts";

const MAX_PENDING = 64;

// Confirmaciones pedidas por el host y aún sin responder, en memoria (un host que muere las
// pierde, y la extensión recibe otra al repetir la llamada). Cada token se consume la primera
// vez que alguien lo presenta, sirva o no: un solo uso de verdad.
export class PendingConfirmations {
  readonly #entropy: EntropySource; readonly #clock: Clock; readonly #pending = new Map<string, PendingConfirmation>();
  constructor(entropy: EntropySource, clock: Clock) { this.#entropy = entropy; this.#clock = clock; }

  open(session: SessionId, tool: ToolName, digest: CallDigest, action: MadeAction, scope: MadeScope): PendingConfirmation {
    const now = this.#clock.now();
    for (const [k, p] of this.#pending) if (p.expired(now)) this.#pending.delete(k);
    while (this.#pending.size >= MAX_PENDING) this.#pending.delete(this.#pending.keys().next().value!);
    const pending = PendingConfirmation.open(ConfirmationToken.fromEntropy(this.#entropy.bytes(16)), session, tool, digest, action, scope, now);
    this.#pending.set(pending.token.value, pending);
    return pending;
  }

  // La llamada repetida con su token: la confirmación si es la misma llamada y a tiempo; si no, null.
  redeem(token: ConfirmationToken, session: SessionId, tool: ToolName, digest: CallDigest): PendingConfirmation | null {
    const p = this.#take(token);
    return p !== null && p.matches(session, tool, digest, this.#clock.now()) ? p : null;
  }

  // Un rechazo o una sesión sin UI: la confirmación de esa sesión, aún vigente, o null.
  settle(token: ConfirmationToken, session: SessionId): PendingConfirmation | null {
    const p = this.#take(token);
    return p !== null && p.session.equals(session) && !p.expired(this.#clock.now()) ? p : null;
  }

  size(): number { return this.#pending.size; }

  #take(token: ConfirmationToken): PendingConfirmation | null {
    const p = this.#pending.get(token.value) ?? null;
    this.#pending.delete(token.value);
    return p;
  }
}
