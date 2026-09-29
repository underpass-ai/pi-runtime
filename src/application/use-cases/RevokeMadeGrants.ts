import type { SessionId } from "../../domain/events/SessionId.ts";
import type { MadeGrant } from "../../domain/made/MadeGrant.ts";
import { RevocationReason } from "../../domain/made/RevocationReason.ts";
import type { StartedCeremony } from "../../domain/made/StartedCeremony.ts";
import type { EventStore } from "../ports/EventStore.ts";
import type { Clock } from "../ports/Clock.ts";
import type { HostLog } from "../ports/HostLog.ts";
import type { MadeFactFactory } from "../services/MadeFactFactory.ts";
import { MadeGrantLedger } from "../services/MadeGrantLedger.ts";
import type { MadeOwner } from "../services/MadeOwner.ts";
import type { RecordFact } from "./RecordFact.ts";

type Tally = { orphans: number; revoked: number };
type Orphan = { grant: MadeGrant; reason: RevocationReason };
const NONE: Tally = { orphans: 0, revoked: 0 };

// S3a §4: revoca en MADE los grants del host que ya no deben vivir y registra cada revocación
// (made.grant_revoked, stream del host). Con sesión, los de esa sesión al cerrarse (todos los que
// el libro tiene sin revocar); sin ella, todos los huérfanos del log
// (arranque del host y `underpass made revoke-orphans`). Sin huérfanos no toca MADE. Un fallo de
// MADE deja el grant para la próxima vez; nunca lanza. Las ejecuciones se encadenan: cada una lee
// el libro cuando termina la anterior, así el cierre y el barrido nunca revocan dos veces lo mismo.
export class RevokeMadeGrants {
  readonly #events: EventStore; readonly #owner: MadeOwner; readonly #record: RecordFact; readonly #facts: MadeFactFactory; readonly #clock: Clock;
  readonly #log: HostLog | null;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(events: EventStore, owner: MadeOwner, record: RecordFact, facts: MadeFactFactory, clock: Clock, log: HostLog | null = null) {
    this.#events = events; this.#owner = owner; this.#record = record; this.#facts = facts; this.#clock = clock; this.#log = log;
  }

  // Cuántos huérfanos había y cuántos quedaron revocados y registrados.
  execute(session: SessionId | null = null): Promise<Tally> {
    const run = this.#tail.then(() => this.#sweep(session)).catch(() => NONE);
    this.#tail = run;
    return run;
  }

  // F3: la instancia que arrancó la sesión llegó a un terminal; se revocan los grants vigentes de la
  // sesión con alcance a esa instancia (ceremony_ended). En la misma cadena que el cierre.
  ceremonyEnded(ceremony: StartedCeremony): Promise<Tally> {
    const run = this.#tail.then(() => this.#revokeAll(() => MadeGrantLedger.forSession(this.#events, ceremony.session).liveOn(ceremony.session, ceremony.scope(), this.#clock.now())
      .map((grant) => ({ grant, reason: RevocationReason.CEREMONY_ENDED })), ceremony.session)).catch(() => NONE);
    this.#tail = run;
    return run;
  }

  // Se resuelve cuando terminan las revocaciones en curso (el apagado las espera con tope).
  async settled(): Promise<void> { await this.#tail; }

  #sweep(session: SessionId | null): Promise<Tally> {
    return this.#revokeAll(() => {
      const ledger = session === null ? MadeGrantLedger.read(this.#events) : MadeGrantLedger.forSession(this.#events, session);
      return ledger.orphans(this.#clock.now()).filter((o) => session === null || o.grant.session.equals(session));
    }, session);
  }

  async #revokeAll(pick: () => Orphan[], session: SessionId | null): Promise<Tally> {
    let orphans: Orphan[];
    try { orphans = pick(); } catch (e) { this.#log?.warn("made grants not read", { reason: (e as Error).name }); return NONE; }
    let revoked = 0;
    for (const { grant, reason } of orphans) {
      try { await this.#owner.revoke(grant.id, reason); }
      catch (e) { this.#log?.warn("made grant not revoked", { grant: grant.id.value, reason: (e as { code?: { value?: string } }).code?.value ?? (e as Error).name }); continue; }
      try { this.#record.execute(this.#facts.grantRevoked(grant.id, grant.session, reason)); revoked++; }
      catch (e) { this.#log?.warn("made revocation not recorded", { grant: grant.id.value, reason: (e as Error).name }); }
    }
    if (revoked > 0) this.#log?.info("made grants revoked", { count: revoked, session: session?.value ?? null });
    return { orphans: orphans.length, revoked };
  }
}
