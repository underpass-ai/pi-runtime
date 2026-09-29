import type { SessionId } from "../../domain/events/SessionId.ts";
import type { Timestamp } from "../../domain/events/Timestamp.ts";
import type { StartedCeremony } from "../../domain/made/StartedCeremony.ts";
import type { MadeCeremonyDto } from "../dto/MadeCeremonyDto.ts";
import type { MadeGrantLedger } from "../services/MadeGrantLedger.ts";

// F3: las instancias que arrancó una sesión, con los grants del host de alcance a cada una.
export class MadeCeremonyMapper {
  static forSession(ledger: MadeGrantLedger, session: SessionId, now: Timestamp): MadeCeremonyDto[] {
    const grants = ledger.grants().filter((g) => g.session.equals(session));
    return ledger.ceremonies(session).map((c: StartedCeremony) => ({
      session: session.value, ceremonyId: c.ceremony.value, summary: c.summary(), state: c.running() ? "running" : "ended", endReason: c.end?.value ?? null, startedAt: c.startedAt.value,
      grants: grants.filter((g) => g.scope.equals(c.scope())).map((g) => ({ grantId: g.id.value, action: g.action.value, state: ledger.state(g, now), reason: ledger.revocation(g) })),
    }));
  }
}
