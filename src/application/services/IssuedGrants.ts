import type { SessionId } from "../../domain/events/SessionId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { MadeAction } from "../../domain/made/MadeAction.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import type { MadeScope } from "../../domain/made/MadeScope.ts";

// Caché de S3a §2.3: los grants que este host emitió y aún cubren algo, por sesión. Un grant
// vigente para la misma acción y alcance evita emitir otro. Se olvida al revocar o caducar.
export class IssuedGrants {
  readonly #bySession = new Map<string, MadeGrant[]>();

  covering(session: SessionId, action: MadeAction, scope: MadeScope, now: Timestamp): MadeGrant | null {
    const live = (this.#bySession.get(session.value) ?? []).filter((g) => !g.expired(now));
    this.#bySession.set(session.value, live);
    return live.find((g) => g.covers(action, scope, now)) ?? null;
  }

  add(grant: MadeGrant): void { this.#bySession.set(grant.session.value, [...(this.#bySession.get(grant.session.value) ?? []), grant]); }
  forget(session: SessionId): void { this.#bySession.delete(session.value); }
}
